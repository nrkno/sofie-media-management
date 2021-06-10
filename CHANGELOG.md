# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

## [1.10.0-release35.0](https://github.com/nrkno/tv-automation-media-management/compare/v1.9.0-release34.0...v1.10.0-release35.0) (2021-06-09)
## [1.9.0-release34.1](https://github.com/nrkno/tv-automation-media-management/compare/v1.9.0-release34.0...v1.9.0-release34.1) (2021-06-10)

## [1.9.0-release34.0](https://github.com/nrkno/tv-automation-media-management/compare/v1.7.0...v1.9.0-release34.0) (2021-05-18)


### Bug Fixes

* avoid quantel watcher crash and restart when it does ([b7cad14](https://github.com/nrkno/tv-automation-media-management/commit/b7cad143da38ef2dade638bbe2cb960af280c47b))

## [1.8.0-release33.0](https://github.com/nrkno/tv-automation-media-management/compare/v1.7.0-release32.0...v1.8.0-release33.0) (2021-04-23)


### Bug Fixes

* failing workstep because of race with watcher ([1e8f91b](https://github.com/nrkno/tv-automation-media-management/commit/1e8f91bc89ebe864313cef87b9e7fc40425afbb1))
* skip getMetadata when duration is missing ([9085187](https://github.com/nrkno/tv-automation-media-management/commit/908518747e53fefa86a4928be161c1d97156dde0))

## [1.8.0-release33.0](https://github.com/nrkno/tv-automation-media-management/compare/v1.7.0-release32.0...v1.8.0-release33.0) (2021-04-23)

### Bug Fixes

- failing workstep because of race with watcher ([1e8f91b](https://github.com/nrkno/tv-automation-media-management/commit/1e8f91bc89ebe864313cef87b9e7fc40425afbb1))
- skip getMetadata when duration is missing ([9085187](https://github.com/nrkno/tv-automation-media-management/commit/908518747e53fefa86a4928be161c1d97156dde0))

## [1.7.0](https://github.com/nrkno/tv-automation-media-management/compare/v1.6.0...v1.7.0) (2021-05-05)

## [1.7.0-release32.0](https://github.com/nrkno/tv-automation-media-management/compare/v1.5.0...v1.7.0-release32.0) (2021-03-23)

### Bug Fixes

- improve user messages for stuck or overly large or long running workflow ([74c6138](https://github.com/nrkno/tv-automation-media-management/commit/74c6138837592c04fe7d2253a013f8ce98a3cc28))

## [1.7.0-release32.0](https://github.com/nrkno/tv-automation-media-management/compare/v1.5.0...v1.7.0-release32.0) (2021-03-23)

### Bug Fixes

- improve user messages for stuck or overly large or long running workflow ([74c6138](https://github.com/nrkno/tv-automation-media-management/commit/74c6138837592c04fe7d2253a013f8ce98a3cc28))

## [1.6.0](https://github.com/nrkno/tv-automation-media-management/compare/v1.5.0...v1.6.0) (2021-05-05)

## [1.6.0-release31.0](https://github.com/nrkno/tv-automation-media-management/compare/v1.5.0-release30.2...v1.6.0-release31.0) (2021-03-02)

## [1.5.0](https://github.com/nrkno/tv-automation-media-management/compare/v1.5.0-release30.2...v1.5.0) (2021-03-19)

## [1.5.0-release30.2](https://github.com/nrkno/tv-automation-media-management/compare/v1.5.0-release30.1...v1.5.0-release30.2) (2021-02-11)

### Bug Fixes

- copy a file when added on a non-quantel storage ([3925c0d](https://github.com/nrkno/tv-automation-media-management/commit/3925c0da458c23d22f64fb9394ec0d6115235a98))
- emit copy workflow only only when file isn't growing ([7f239de](https://github.com/nrkno/tv-automation-media-management/commit/7f239de87cf7e0b3d5023e0a363a7ed04c24ca9b))

## [1.5.0-release30.0](https://github.com/nrkno/tv-automation-media-management/compare/v1.4.0-release28.2...v1.5.0-release30.0) (2021-02-11)

### Features

- Set relative worker job priority via a config manifest setting([5265f93](https://github.com/nrkno/tv-automation-media-management/commit/5265f93d88dc9e1bf2cdfca2ce9781ee61ca6e72))

## [1.4.0-release28.2](https://github.com/nrkno/tv-automation-media-management/compare/v1.4.0-release28.1...v1.4.0-release28.2) (2020-12-14)

### Bug Fixes

- more typings issues ([8f73bfe](https://github.com/nrkno/tv-automation-media-management/commit/8f73bfeb0de2b6908642427b6713a06d5772b0a4))

## [1.4.0-release28.1](https://github.com/nrkno/tv-automation-media-management/compare/v1.4.0-release28.0...v1.4.0-release28.1) (2020-12-14)

### Bug Fixes

- typings issues ([69dc5ba](https://github.com/nrkno/tv-automation-media-management/commit/69dc5ba37ad10d617cf5a458d06ff8e45aa8819b))
- typings issues ([10ec0d2](https://github.com/nrkno/tv-automation-media-management/commit/10ec0d2fd527d536683e02a0f4ac2df26a735e1b))

## [1.4.0-release28.0](https://github.com/nrkno/tv-automation-media-management/compare/v1.3.0...v1.4.0-release28.0) (2020-12-14)

### Bug Fixes

- update generate-deps-metadata script ([593503f](https://github.com/nrkno/tv-automation-media-management/commit/593503fcad66e4c0cf2c7bf2b7e399f797c2c8e1))

## [1.3.0](https://github.com/nrkno/tv-automation-media-management/compare/v1.3.0-release27.0...v1.3.0) (2020-12-08)

### Bug Fixes

- prevent MPEG-DASH hangs by reading everything into RAM rather than streaming ([e366b15](https://github.com/nrkno/tv-automation-media-management/commit/e366b15a5cb6524f16334219d25fc233e0800f2a))
- thumbnail serving ([940819a](https://github.com/nrkno/tv-automation-media-management/commit/940819ad794337619aef7cabf012e2548b774d75))

## [1.3.0-release27.0](https://github.com/nrkno/tv-automation-media-management/compare/v1.2.1...v1.3.0-release27.0) (2020-11-16)

### Bug Fixes

- don't repeat successful Quantel work on restart ([23a3b90](https://github.com/nrkno/tv-automation-media-management/commit/23a3b9055d359b86070add6ac2f83e69e14d94d1))
- handle black frame detect durations with an 's' unit specifier ([4e9009a](https://github.com/nrkno/tv-automation-media-management/commit/4e9009ad20673dbab0d202534174dafd1f16199d))
- missed merge conflict ([2258c1b](https://github.com/nrkno/tv-automation-media-management/commit/2258c1bc9a5b7e4691ffa9a244cae7256ca5a75c))
- replace rather than duplicate failed work on restart ([9b482dc](https://github.com/nrkno/tv-automation-media-management/commit/9b482dcfc3532b54d22ee807157208ee06f9f23e))
- resend sub-device status after core reconnect ([384b37e](https://github.com/nrkno/tv-automation-media-management/commit/384b37e8de97adcd8f35313eddc8440d74600581))

### [1.2.1](https://github.com/nrkno/tv-automation-media-management/compare/v1.2.1-0...v1.2.1) (2020-09-28)

### Bug Fixes

- create objects in quantel monitor if missing and destination ID in config manifest ([95e243d](https://github.com/nrkno/tv-automation-media-management/commit/95e243dd8c4e88507fcbce7aa99973cac1854959))

### [1.2.1-0](https://github.com/nrkno/tv-automation-media-management/compare/v1.2.0...v1.2.1-0) (2020-09-09)

### Bug Fixes

- sort ClipGUIDs duplicated on a pool to select the latest one ([57f13a9](https://github.com/nrkno/tv-automation-media-management/commit/57f13a93536c4329886fdf8c0b3cef6fa8c37c1d))

## [1.2.0](https://github.com/nrkno/tv-automation-media-management/compare/v1.2.0-3...v1.2.0) (2020-08-21)

## [1.2.0-3](https://github.com/nrkno/tv-automation-media-management/compare/v1.2.0-2...v1.2.0-3) (2020-08-21)

### Bug Fixes

- handle black frame detect durations with an 's' unit specifier ([8ef39e4](https://github.com/nrkno/tv-automation-media-management/commit/8ef39e4941cadc8fa94e995bf48da99d514da12c))
- reference correct \_id property when making file names ([db1db5e](https://github.com/nrkno/tv-automation-media-management/commit/db1db5e7a981c72c4a6af7f5d1ec48d82dac6998))
- resilient to quantel check being called with undefined - possible bad data on initialization ([2aa4427](https://github.com/nrkno/tv-automation-media-management/commit/2aa4427993e51b84cc3fb5a96c8c53cb228bf3a8))
- stop circular depedency in logging from causing jobs to NaN% ([e9bb402](https://github.com/nrkno/tv-automation-media-management/commit/e9bb402b4af451cd42b30f889e1dbe662e3520d0))
- stop wiping workflow steps before persisting them ([134cdd1](https://github.com/nrkno/tv-automation-media-management/commit/134cdd190f8955d6a9a26514b58efd05c5ff57ae))
- tolerate clips with no audio / audio format is empty string ([458ad38](https://github.com/nrkno/tv-automation-media-management/commit/458ad38bcef4b95dd7d0671a45e9375b95724743))

## [1.2.0-2](https://github.com/nrkno/tv-automation-media-management/compare/v1.2.0-1...v1.2.0-2) (2020-08-10)

### Bug Fixes

- deal with a quantel monitor set before work has started ([1e41e7c](https://github.com/nrkno/tv-automation-media-management/commit/1e41e7cc075885d32e04e277d32b31464eb2a091))
- metadata generation for quantel simulated rather than via ffprobe ([1752ee7](https://github.com/nrkno/tv-automation-media-management/commit/1752ee71c5b41b3d935a014b2703b10b153e513f))
- previews folder default should be set in app ([509288b](https://github.com/nrkno/tv-automation-media-management/commit/509288bb0725ebf74ed9efdd4c2523ec858780bc))
- reporting of sub-device status for Quantel devices ([1a7ae87](https://github.com/nrkno/tv-automation-media-management/commit/1a7ae87d1ddf8c8f05fa438b39b39b01acdc96b5))
- revert Quantel Gateway client typescript version to 3.8 ([c6eb749](https://github.com/nrkno/tv-automation-media-management/commit/c6eb7490bafd7be6677191abd827c40f78bf7a81))

## [1.2.0-1](https://github.com/nrkno/tv-automation-media-management/compare/v1.2.0-0...v1.2.0-1) (2020-06-26)

### Bug Fixes

- config manifest has serverId as a string when number is expected ([6596dce](https://github.com/nrkno/tv-automation-media-management/commit/6596dce9ce8b89090b5d66c38f523d7dd3631100))
- config manifest has serverId as a string when number is expected ([1d7de78](https://github.com/nrkno/tv-automation-media-management/commit/1d7de78aa09b880f49a3516d450021c828d41f53))
- don't add a job as outstanding work when other jobs in the same workflow are running ([718c24a](https://github.com/nrkno/tv-automation-media-management/commit/718c24acac3a89893bdd312d6823837e140fdfc8))
- nexe build not working on node >12.16.0 ([c059612](https://github.com/nrkno/tv-automation-media-management/commit/c05961235446de4bdac9f6bf73c9b14264ebf3c9))
- release21 of core did not happen, so all changes now part of release 22.1 ([db8eb2f](https://github.com/nrkno/tv-automation-media-management/commit/db8eb2fdbba9b54ec37389ab399ce4f433d2e8e7))
- square thumbnails when dimensions provided ([d8668ee](https://github.com/nrkno/tv-automation-media-management/commit/d8668ee36217e449d7f79a66108bbd39a03adcca))

## [1.2.0-0](https://github.com/nrkno/tv-automation-media-management/compare/v1.1.0...v1.2.0-0) (2020-05-28)

### Features

- Add crosscompile build script ([510dd31](https://github.com/nrkno/tv-automation-media-management/commit/510dd31a38096953b27beed20afc342f1623ccf9))

### Bug Fixes

- automated tests should now work, enabling CI builds ([c696fd9](https://github.com/nrkno/tv-automation-media-management/commit/c696fd9a7cebac3073e25347f223a31c172a240e))
- build exe with nexe as leveldown works better with that ([8bb37bd](https://github.com/nrkno/tv-automation-media-management/commit/8bb37bd92ec12bae6edc5a27bf70e1e8edef7853))
- closure issue and typings ([49a5903](https://github.com/nrkno/tv-automation-media-management/commit/49a5903fb8d253a624c590bea83563d883ad2158))
- disable linux builds and reenable running tests ([f18330c](https://github.com/nrkno/tv-automation-media-management/commit/f18330cbe2011ebe0512f1dc367d52fe20b4a626))
- limit disk usage warnings on Windows to local disks only ([0c0d407](https://github.com/nrkno/tv-automation-media-management/commit/0c0d4075574cf2326a64f10d29479d4561857685))
- make playout gateway HTTP watcher a happy bunny again ([080dd07](https://github.com/nrkno/tv-automation-media-management/commit/080dd07016e71fa172863738ab93d9290b9e1c06))
- manager not initializing properly when no ready event from chokidar ([a8d45e1](https://github.com/nrkno/tv-automation-media-management/commit/a8d45e133a1e1ab1d3c747ff9f64ccdb490f7858))
- missing comma ([a9b6c71](https://github.com/nrkno/tv-automation-media-management/commit/a9b6c71c3523140dd3c9581e530a15b88e3651c4))
- process reference and metadata analysis ([a1cd33a](https://github.com/nrkno/tv-automation-media-management/commit/a1cd33aa0e648b48ca814da1bcfb6ead3f5e0bac))
- **config manifest:** fix labels in manifest ([23fa7d9](https://github.com/nrkno/tv-automation-media-management/commit/23fa7d92a00d49da1c9fbff213b4ce3169925add))
- **config manifest:** fix manifest to work correctly ([a8927b1](https://github.com/nrkno/tv-automation-media-management/commit/a8927b1490514b98c39609aee7f2b01d109694a1))

## [1.1.0](https://github.com/nrkno/tv-automation-media-management/compare/v1.1.0-1...v1.1.0) (2020-01-24)

## [1.1.0-1](https://github.com/nrkno/tv-automation-media-management/compare/v1.1.0-0...v1.1.0-1) (2020-01-14)

### Bug Fixes

- **config manifest:** fix labels in manifest ([1e3fd69](https://github.com/nrkno/tv-automation-media-management/commit/1e3fd69cdb6831f809104c86e74bf7fcc237015c))
- **config manifest:** fix manifest to work correctly ([2e41fb7](https://github.com/nrkno/tv-automation-media-management/commit/2e41fb71b74c9ce08b85433986524e1e650049d8))

## [1.1.0-0](https://github.com/nrkno/tv-automation-media-management/compare/v1.0.2...v1.1.0-0) (2020-01-08)

### Features

- device config manifest ([#14](https://github.com/nrkno/tv-automation-media-management/issues/14)) ([3774e76](https://github.com/nrkno/tv-automation-media-management/commit/3774e76b52f68efb1610313c152b08603df1cb17))

### [1.0.2](https://github.com/nrkno/tv-automation-media-management/compare/v1.0.2-0...v1.0.2) (2019-11-25)

### [1.0.2-0](https://github.com/nrkno/tv-automation-media-management/compare/v1.0.1...v1.0.2-0) (2019-11-25)

### Bug Fixes

- **media scanner:** sometimes the PouchDB restart (caused by JSON syntax error) would be registered as disconnection instead of just restarting the PouchDB stream ([b858458](https://github.com/nrkno/tv-automation-media-management/commit/b858458a2b73ad7ddeff234f3bd1d289f60ee9b1))
- **watchdog:** issue with "No WorkFlow has finished in the last 15 minutes" ([655c47f](https://github.com/nrkno/tv-automation-media-management/commit/655c47fbc312fa8492b0ce9ef82bebfdc1114385))

<a name="1.0.1"></a>

## [1.0.1](https://github.com/nrkno/tv-automation-media-management/compare/v1.0.1-0...v1.0.1) (2019-10-29)

<a name="1.0.1-0"></a>

## [1.0.1-0](https://github.com/nrkno/tv-automation-media-management/compare/v1.0.0-1...v1.0.1-0) (2019-10-29)

### Bug Fixes

- add mediainfo property for quantel clips that are ready to play ([f941288](https://github.com/nrkno/tv-automation-media-management/commit/f941288))
- update typings from Core ([81a7cc0](https://github.com/nrkno/tv-automation-media-management/commit/81a7cc0))

<a name="1.0.0-1"></a>

# [1.0.0-1](https://github.com/nrkno/tv-automation-media-management/compare/v0.2.3-1...v1.0.0-1) (2019-10-02)

### Bug Fixes

- an issue with onExpectedChanged ([7b37e45](https://github.com/nrkno/tv-automation-media-management/commit/7b37e45))
- if the scanner shouldn't handle a changed EMI, then treat it as removed ([3bd35c8](https://github.com/nrkno/tv-automation-media-management/commit/3bd35c8))
- localStorageGenerator - add separate "Scan" action ([aacede3](https://github.com/nrkno/tv-automation-media-management/commit/aacede3))
- quantel http handler ([64ea728](https://github.com/nrkno/tv-automation-media-management/commit/64ea728))
- slow workStep updates when prioritizing, etc. ([7b3e811](https://github.com/nrkno/tv-automation-media-management/commit/7b3e811))

### Features

- retry storage check when doing a storage check and not triggered by expectedItem ([3c021bf](https://github.com/nrkno/tv-automation-media-management/commit/3c021bf))
- **quantel HTTP:** working quantel http transfer ([5e3c210](https://github.com/nrkno/tv-automation-media-management/commit/5e3c210))
- **quantelHttpHandler:** WIP ([bf84f18](https://github.com/nrkno/tv-automation-media-management/commit/bf84f18))
- **quantelStorage:** add quantel to storage factory ([1e897a2](https://github.com/nrkno/tv-automation-media-management/commit/1e897a2))
- **watchdog:** run watchdog after every finished workStep ([d6c7654](https://github.com/nrkno/tv-automation-media-management/commit/d6c7654))
