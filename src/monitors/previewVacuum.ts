import { LoggerInstance } from 'winston'
import { MediaObject } from '../api/mediaObject'
import * as path from 'path'
import * as fs from 'fs-extra'
import { DeviceSettings } from '../api'

export class PreviewAndThumbnailVacuum {
	private changes: PouchDB.Core.Changes<MediaObject>
	constructor(
		private mediaDB: PouchDB.Database<MediaObject>,
		private config: DeviceSettings,
		private logger: LoggerInstance
	) {
		this.start()

		// TODO should all previews be checked on initialization.
		//      This was not done in manual mode.
	}

	private async rowChanged(id: string, deleted?: boolean) {
		if (deleted) {
			await this.deletePreview(id)
			await this.deleteThumbnail(id)
		}
	}

	private async deletePreview(mediaId: string) {
		const destPath = path.join(
			(this.config.paths && this.config.paths.resources) || '',
			(this.config.previews && this.config.previews.folder) || 'previews',
			`${mediaId}.webm`
		)
		this.logger.info(`PreviewAndThumbnailVacuum: deleting preview file "${destPath}" that is no longer required`)
		await fs.unlink(destPath).catch((err: NodeJS.ErrnoException) => {
			if (err.code && err.code !== 'ENOENT' && err.message.indexOf('no such file or directory') === -1) {
				this.logger.error(`PreviewAndThumbnailVacuum: error deleting preview file "${err.stack}"`, err)
			}
		})
	}

	private async deleteThumbnail(mediaId: string) {
		const destPath = path.join(
			(this.config.paths && this.config.paths.resources) || '',
			(this.config.thumbnails && this.config.thumbnails.folder) || 'thumbs',
			`${mediaId}.png`
		)
		this.logger.info(`PreviewAndThumbnailVacuum: deleting preview file "${destPath}" that is no longer required`)
		await fs.unlink(destPath).catch((err: NodeJS.ErrnoException) => {
			if (err.code && err.code !== 'ENOENT' && err.message.indexOf('no such file or directory') === -1) {
				this.logger.error(`PreviewAndThumbnailVacuum: error deleting thumbnail file "${err.stack}"`, err)
			}
		})
	}

	start(): void {
		this.changes = this.mediaDB
			.changes({
				since: 'now',
				live: true
			})
			.on('change', (change) => {
				this.rowChanged(change.id, change.deleted)
			})
			.on('error', (err) => {
				this.logger.error(`PreviewAndThumbnailVacuum: error from change listener`, err)
			})
	}

	stop(): void {
		this.changes.removeAllListeners()
		this.logger.info(`PreviewAndThumbnailVacuum: no longer reacting to media database changes`)
	}
}
