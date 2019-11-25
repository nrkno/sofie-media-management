# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

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
