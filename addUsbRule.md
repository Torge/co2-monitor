Wie man libusb ohne sudo verwenden kann:

Mit "lsusb" vid und pid rausfinden, sind mit : getrennt
  
SUBSYSTEM=="usb", ATTRS{idVendor}=="VID", ATTRS{idProduct}=="PID", MODE="0666"

das hierein packen:
/etc/udev/rules.d/100-usb-rule.rules