# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

## [1.2.0-0](https://github.com/nrkno/tv-automation-media-management/compare/v1.1.0...v1.2.0-0) (2020-05-28)


### Features

* Add crosscompile build script ([510dd31](https://github.com/nrkno/tv-automation-media-management/commit/510dd31a38096953b27beed20afc342f1623ccf9))


### Bug Fixes

* automated tests should now work, enabling CI builds ([c696fd9](https://github.com/nrkno/tv-automation-media-management/commit/c696fd9a7cebac3073e25347f223a31c172a240e))
* build exe with nexe as leveldown works better with that ([8bb37bd](https://github.com/nrkno/tv-automation-media-management/commit/8bb37bd92ec12bae6edc5a27bf70e1e8edef7853))
* closure issue and typings ([49a5903](https://github.com/nrkno/tv-automation-media-management/commit/49a5903fb8d253a624c590bea83563d883ad2158))
* disable linux builds and reenable running tests ([f18330c](https://github.com/nrkno/tv-automation-media-management/commit/f18330cbe2011ebe0512f1dc367d52fe20b4a626))
* limit disk usage warnings on Windows to local disks only ([0c0d407](https://github.com/nrkno/tv-automation-media-management/commit/0c0d4075574cf2326a64f10d29479d4561857685))
* make playout gateway HTTP watcher a happy bunny again ([080dd07](https://github.com/nrkno/tv-automation-media-management/commit/080dd07016e71fa172863738ab93d9290b9e1c06))
* manager not initializing properly when no ready event from chokidar ([a8d45e1](https://github.com/nrkno/tv-automation-media-management/commit/a8d45e133a1e1ab1d3c747ff9f64ccdb490f7858))
* missing comma ([a9b6c71](https://github.com/nrkno/tv-automation-media-management/commit/a9b6c71c3523140dd3c9581e530a15b88e3651c4))
* process reference and metadata analysis ([a1cd33a](https://github.com/nrkno/tv-automation-media-management/commit/a1cd33aa0e648b48ca814da1bcfb6ead3f5e0bac))
* **config manifest:** fix labels in manifest ([23fa7d9](https://github.com/nrkno/tv-automation-media-management/commit/23fa7d92a00d49da1c9fbff213b4ce3169925add))
* **config manifest:** fix manifest to work correctly ([a8927b1](https://github.com/nrkno/tv-automation-media-management/commit/a8927b1490514b98c39609aee7f2b01d109694a1))

## [1.1.0](https://github.com/nrkno/tv-automation-media-management/compare/v1.1.0-1...v1.1.0) (2020-01-24)

## [1.1.0-1](https://github.com/nrkno/tv-automation-media-management/compare/v1.1.0-0...v1.1.0-1) (2020-01-14)


### Bug Fixes

* **config manifest:** fix labels in manifest ([1e3fd69](https://github.com/nrkno/tv-automation-media-management/commit/1e3fd69cdb6831f809104c86e74bf7fcc237015c))
* **config manifest:** fix manifest to work correctly ([2e41fb7](https://github.com/nrkno/tv-automation-media-management/commit/2e41fb71b74c9ce08b85433986524e1e650049d8))

## [1.1.0-0](https://github.com/nrkno/tv-automation-media-management/compare/v1.0.2...v1.1.0-0) (2020-01-08)


### Features

* device config manifest ([#14](https://github.com/nrkno/tv-automation-media-management/issues/14)) ([3774e76](https://github.com/nrkno/tv-automation-media-management/commit/3774e76b52f68efb1610313c152b08603df1cb17))

### [1.0.2](https://github.com/nrkno/tv-automation-media-management/compare/v1.0.2-0...v1.0.2) (2019-11-25)

### [1.0.2-0](https://github.com/nrkno/tv-automation-media-management/compare/v1.0.1...v1.0.2-0) (2019-11-25)


### Bug Fixes

* **media scanner:** sometimes the PouchDB restart (caused by JSON syntax error) would be registered as disconnection instead of just restarting the PouchDB stream ([b858458](https://github.com/nrkno/tv-automation-media-management/commit/b858458a2b73ad7ddeff234f3bd1d289f60ee9b1))
* **watchdog:** issue with "No WorkFlow has finished in the last 15 minutes" ([655c47f](https://github.com/nrkno/tv-automation-media-management/commit/655c47fbc312fa8492b0ce9ef82bebfdc1114385))

<a name="1.0.1"></a>
## [1.0.1](https://github.com/nrkno/tv-automation-media-management/compare/v1.0.1-0...v1.0.1) (2019-10-29)



<a name="1.0.1-0"></a>
## [1.0.1-0](https://github.com/nrkno/tv-automation-media-management/compare/v1.0.0-1...v1.0.1-0) (2019-10-29)


### Bug Fixes

* add mediainfo property for quantel clips that are ready to play ([f941288](https://github.com/nrkno/tv-automation-media-management/commit/f941288))
* update typings from Core ([81a7cc0](https://github.com/nrkno/tv-automation-media-management/commit/81a7cc0))



<a name="1.0.0-1"></a>
# [1.0.0-1](https://github.com/nrkno/tv-automation-media-management/compare/v0.2.3-1...v1.0.0-1) (2019-10-02)


### Bug Fixes

* an issue with onExpectedChanged ([7b37e45](https://github.com/nrkno/tv-automation-media-management/commit/7b37e45))
* if the scanner shouldn't handle a changed EMI, then treat it as removed ([3bd35c8](https://github.com/nrkno/tv-automation-media-management/commit/3bd35c8))
* localStorageGenerator - add separate "Scan" action ([aacede3](https://github.com/nrkno/tv-automation-media-management/commit/aacede3))
* quantel http handler ([64ea728](https://github.com/nrkno/tv-automation-media-management/commit/64ea728))
* slow workStep updates when prioritizing, etc. ([7b3e811](https://github.com/nrkno/tv-automation-media-management/commit/7b3e811))


### Features

* retry storage check when doing a storage check and not triggered by expectedItem ([3c021bf](https://github.com/nrkno/tv-automation-media-management/commit/3c021bf))
* **quantel HTTP:** working quantel http transfer ([5e3c210](https://github.com/nrkno/tv-automation-media-management/commit/5e3c210))
* **quantelHttpHandler:** WIP ([bf84f18](https://github.com/nrkno/tv-automation-media-management/commit/bf84f18))
* **quantelStorage:** add quantel to storage factory ([1e897a2](https://github.com/nrkno/tv-automation-media-management/commit/1e897a2))
* **watchdog:** run watchdog after every finished workStep ([d6c7654](https://github.com/nrkno/tv-automation-media-management/commit/d6c7654))
