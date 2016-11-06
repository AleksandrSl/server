#!/usr/bin/env node

var reporter = require('../../reporter')
var reports = require('./reports')
var path = require('path')
var fs = require('fs')

reporter.now = function () {
  return new Date((new Date()).getTimezoneOffset() * 60000)
}

for (var test in reports) {
  var output = reporter.apply({ }, reports[test])
  fs.writeFileSync(path.join(__dirname, test + '.out'), output)
  process.stdout.write(output)
}
