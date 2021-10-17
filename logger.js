const fs = require('fs');
const { deflate } = require('zlib');

const logFolder = __dirname + '/log'
const curDate = new Date().toISOString().slice(0, 10)
const logPath = logFolder + '/' + curDate + '.log'
if (!fs.existsSync(logFolder)){
  fs.mkdirSync(logFolder);
}
var log_file = fs.createWriteStream(logPath, {flags : 'a'});

module.exports = function (key, value) {
  const data = [Date.now(), key, value]
  log_file.write(data.join(';') + '\n')
}