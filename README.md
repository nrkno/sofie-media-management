Please note that this repository has been archived as this component has been replaced with [Package Manager](https://github.com/nrkno/sofie-package-manager).  
As of Sofie 1.50.0, Media Manager will no longer operate without changes. The remaining APIs needed for Media Manager are expected to be removed in 1.52.0, or a release soon after.

# Sofie: The Modern TV News Studio Automation System (Media Management)
An application for managing media, used by [Sofie Server Core](https://github.com/nrkno/tv-automation-server-core).

This application is a part of the [**Sofie** TV News Studio Automation System](https://github.com/nrkno/Sofie-TV-automation/).

The system allows to use local ingest, expected media items based on the Running Order contents, and simple watch folder mirroring workflows. Supported storage handlers include local folders and CIFS shares. Target platform for the system is Windows and the application is expected to be controlled using the Caspar CG Launcher, but the architecture is platform-agnostic.  

## Usage
```
// Development:
yarn buildstart -host 127.0.0.1 -port 3000 -log "log.log"
// Production:
yarn build-win32
```

**CLI arguments:**

| Argument  | Description | Environment variable |
| ------------- | ------------- | --- |
| -host  | Hostname or IP of Core  | CORE_HOST  |
| -port  | Port of Core   |  CORE_PORT |
| -ssl	| Enable a secure connection to Core |  CORE_SSL |
| -log  | Path to output log |  CORE_LOG |
| -id   | Device ID to use | DEVICE_ID |

## Installation for dev

* yarn
* yarn build
* yarn test

### Dev dependencies:

* yarn
	https://yarnpkg.com

* jest
	yarn global add jest

## Quantel URL Scheme

The Quantel Scanner connects to a Quantel Gateway and through it contacts the Quantel ISA to query it about Expected Media Items. The Expected Media Items use a `quantel:` url scheme to locate clips:

`quantel:[Clip GUID|?Title]`

| Argument | Description |
| -------- | ----------- |
| Clip GUID | The GUID of a clip to be monitored |
| Title | A Title to be used to search the ISA database |
