const istanbul = require('istanbul');
const execSync = require('child_process').execSync;

const instrumenter = new istanbul.Instrumenter({
  esModules: true,
  compact: false,
});

// get the current commit
function getSha() {
  return execSync('git rev-parse HEAD').toString().trim();
}

module.exports = function(src) {
  const opts = Object.assign({
    ignore: ['/node_modules/'],
    delay_s: 1000,
    interval_s: 10000,
    token: 'cctoken123',
    entry: this._compiler.options.entry[0],
  }, src.query || {});

  const shouldIgnore = opts.ignore.reduce((memo, val) => {
    return memo || this.resourcePath.indexOf(val) >= 0;
  }, false);

  if (shouldIgnore) {
    return src;
  }

  console.log(`Instrumenting ${this.resourcePath}...`);
  let ret = instrumenter.instrumentSync(src, this.resourcePath);

  if (this.resourcePath == opts.entry) {
    const sha = getSha();
    ret += `
      var token = '';
      ;;
      window.transmit = function() {
        // get the presigned put request
        var ppreq = 'http://localhost/upload_cpc?package=bash-20200430-d757c17&token=6b8b071a-e7c0-44f2-a50d-3b31a5031eb9&branch=master&commit=${sha}&build=&build_url=&name=&tag=&slug=robert-codecov%2Fcodecov-api&service=&flags=&pr=&job=';
        var res = fetch(ppreq, {
          method: 'POST',
          'Content-Type': 'text/plain',
          'Content-Encoding': 'gzip',
          'X-Content-Encoding': 'gzip',
          'Accept': 'text/plain',
        })
          .then(function(response) { return response.text() })
          .then(function(signedput) {
            // Create a file object from coverage json
            const cov = JSON.stringify(__coverage__);
            const blob = new Blob([cov], {type: "application/json"});
            const f = new File([blob], "fn.json");
            
            return fetch(signedput, {
              method: 'PUT',
              'Content-Type': 'application/x-gzip',
              'Content-Encoding': 'gzip',
              'x-amz-acl': 'public-read',
              body: f,
            })
          });
      }
    `;
  }

  return ret;
}
