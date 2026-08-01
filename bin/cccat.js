#!/usr/bin/env node
'use strict';
// Same monitor, cat in the panel: `ccduck --cat`, minus the typing.
require('../src/main.js').run(['--cat', ...process.argv.slice(2)]);
