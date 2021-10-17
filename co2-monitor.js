'use strict';
const os = require('os');
const EventEmitter = require('events');
const usb = require('usb');

/**
 * CO2-monitor Connection
 * @class Monitor
 */
class CO2Monitor extends EventEmitter {
    /**
     * @param {[Object]} options - Optional configuration.
     * @param {[Number]} options.vid - VendorId of CO2 monitor.
     * @param {[Number]} options.pid - ProductId of CO2 monitor.
     * @param {[Boolean]} options.debug - Enable debug tracing of usb connection.
     * @constructor
     */
    constructor(options) {
        super();
        const o = options;
        this._vid = (o && o.vid) || 0x04D9;
        this._pid = (o && o.pid) || 0xA052;
        console.log()
        this._debug = (o && o.debug) || false;
        // Random key buffer.
        this._key = Buffer.from([
            0xc4, 0xc6, 0xc0, 0x92, 0x40, 0x23, 0xdc, 0x96
        ]);

        this._device = null;
        this._interface = null;
        this._endpoint = null;

        this._co2 = null;
        this._temp = null;
        this._hum = null;

        if (this._debug) {
            usb.setDebugLevel(4);
        }
    }

    /**
     * Setup usb connection to CO2 monitor.
     * @param {Function} callback
     */
    connect(callback) {
        this._device = usb.findByIds(this._vid, this._pid);
        if (!this._device) {
            const err = new Error('Device not found!');
            this.emit('error', err);
            return callback(err);
        }
        // Open device to use control methods.
        this._device.open();
        this._interface = this._device.interfaces[0];
        // Detach linux kernel driver, or won't get endpoint connection.
        if (os.platform() === 'linux' && this._interface.isKernelDriverActive()) {
            this._interface.detachKernelDriver();
        }
        if (!this._interface) {
            const err = new Error('Interface not found!');
            this.emit('error', err);
            return callback(err);
        }
        // Parameters for `libusb_control_transfer`.
        const bmReqType = 0x21,
            bReq = 0x09,
            wValue = 0x0300,
            wIdx = 0x00;
        // Setup OUT transfer.
        this._device.controlTransfer(bmReqType, bReq, wValue, wIdx, this._key, (err) => {
            if (err) {
                this.emit('error', err);
                return callback(err);
            }
            this._interface.claim();
            this._endpoint = this._interface.endpoints[0];
            this.emit('connect', this._endpoint);
            return callback();
        });
    }

    /**
     * Close device connection.
     * @param {Function} callback
     */
    disconnect(callback) {
        this._endpoint.stopPoll(() => {
            if (os.platform() === 'linux') {
                this._interface.attachKernelDriver();
            }
            this._interface.release(true, (err) => {
                if (err) {
                    this.emit('error', err);
                }
                this._device.close();
                this.emit('disconnect');
                return callback(err);
            });
        });
    }

    /**
     * Start data transfer from CO2 monitor.
     * @param {[Function]} callback
     */
    transfer(callback) {
        callback = callback || (() => { });
        const transLen = 8;
        this._endpoint.transfer(transLen, (err) => {
            if (err) {
                this.emit('error', err);
                return callback(err);
            }
            const nTransfers = 8;
            this._endpoint.startPoll(nTransfers);

            this._endpoint.on('data', (data) => {
                // Skip decryption for modern CO2 sensors.
                const decrypted = data[4] != 0x0d ? CO2Monitor._decrypt(this._key, data) : data;
                const checksum = decrypted[3],
                    sum = decrypted.slice(0, 3)
                        .reduce((s, item) => (s + item), 0) & 0xff;
                // Validate checksum (or skip if magic byte detected).
                if (decrypted[4] !== 0x0d || checksum !== sum) {
                    return this.emit(
                        'error', new Error('Checksum Error.')
                    );
                }

                const op = decrypted[0];
                const value = decrypted[1] << 8 | decrypted[2];
                switch (op) {
                    case 0x42:
                        // Temperature
                        this._temp = parseFloat(
                            (value / 16 - 273.15).toFixed(2)
                        );
                        this.emit('temp', this._temp);
                        break;
                    case 0x50:
                        // CO2
                        this._co2 = value;
                        this.emit('co2', this._co2);
                        break;
                    case 0x41:
                        // humidity
                        this._hum = parseFloat(value / 100);
                        this.emit('hum', this._hum);
                    default:
                        break;
                }
            });
            this._endpoint.on('error', (err) =>
                this.emit('error', err)
            );
            return callback();
        });
    }

    /**
     * Get latest Ambient Temperature (Tamb)
     * @returns {Number}
     */
    get temperature() {
        return this._temp;
    }

    /**
     * Get latest Relative Concentration of CO2 (CntR)
     * @returns {Number}
     */
    get co2() {
        return this._co2;
    }

    /**
     * Get latest Relative Air Humidity
     * @returns {Number}
     */
    get humidity() {
        return this._hum;
    }

    /**
     * Decrypt data fetched from CO2 monitor.
     * @param {Buffer} key
     * @param {Buffer} data
     * @see https://hackaday.io/project/5301-reverse-engineering-a-low-cost-usb-co-monitor/log/17909-all-your-base-are-belong-to-us
     * @static
     */
    static _decrypt(key, data) {
        const cstate = [
            0x48, 0x74, 0x65, 0x6D, 0x70, 0x39, 0x39, 0x65
        ];
        const shuffle = [2, 4, 0, 7, 1, 6, 5, 3];
        const length = cstate.length;
        let i;
        const dataXor = [];
        for (i = 0; i < length; i++) {
            const idx = shuffle[i];
            dataXor[idx] = data[i] ^ key[idx];
        }
        const dataTmp = [];
        for (i = 0; i < length; i++) {
            dataTmp[i] = ((dataXor[i] >> 3) | (dataXor[(i - 1 + 8) % 8] << 5)) & 0xff;
        }
        const results = [];
        for (i = 0; i < length; i++) {
            const ctmp = ((cstate[i] >> 4) | (cstate[i] << 4)) & 0xff;
            results[i] = ((0x100 + dataTmp[i] - ctmp) & 0xff);
        }
        return results;
    }
}

module.exports = CO2Monitor;