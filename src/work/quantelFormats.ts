import { ClipData } from 'tv-automation-quantel-gateway-client/dist/quantelTypes';

function makeVideoStream(clipData: ClipData): object {
    if (clipData.VideoFormats === '') {
        throw new Error('Cannot make video stream metadata with an empty video format.')
    }
    let videoFormat = clipData.VideoFormats.split(' ').map(x => +x).sort().reverse()[0]

    return  {
        "index": 0,
        "codec_name": videoFormat > 100 ? "h264" : "mpeg2video",
        "codec_long_name": videoFormat > 100 ? "H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10" : "MPEG-2 video",
        "profile": videoFormat > 100 ? "High 4:2:2 Intra" : "4:2:2",
        "codec_type": "video",
        "codec_time_base": videoFormat > 100 ? "1/50" : "1/25",
        "codec_tag_string": "[0][0][0][0]",
        "codec_tag": "0x0000",
        "width": videoFormat > 100 ? 1920 : 720,
        "height": videoFormat > 100 ? 1080 : 608,
        "coded_width": videoFormat > 100 ? 1920 : 0,
        "coded_height": videoFormat > 100 ? 1088 : 0,
        "has_b_frames": 0,
        "sample_aspect_ratio": "608:405",
        "display_aspect_ratio": "16:9",
        "pix_fmt": videoFormat > 100 ? "yuv422p10le" : "yuv422p",
        "level": videoFormat > 100 ? 41 : 5,
        "color_range": "tv",
        "color_space": "bt709",
        "color_transfer": "bt709",
        "color_primaries": "bt709",
        "chroma_location": videoFormat > 100 ? "left" : "topleft",
        "field_order": "tt",
        "refs": 1,
        "is_avc": "false",
        "nal_length_size": "0",
        "r_frame_rate": "25/1",
        "avg_frame_rate": "25/1",
        "time_base": "1/25",
        "start_pts": 0,
        "start_time": "0.000000",
        "duration_ts": +clipData.Frames,
        "duration": `"${+clipData.Frames / 25}"`,
        "bits_per_raw_sample": "10",
        "disposition": {
            "default": 0,
            "dub": 0,
            "original": 0,
            "comment": 0,
            "lyrics": 0,
            "karaoke": 0,
            "forced": 0,
            "hearing_impaired": 0,
            "visual_impaired": 0,
            "clean_effects": 0,
            "attached_pic": 0,
            "timed_thumbnails": 0
        },
        "tags": {
        }
    }
}

/*
        {
            "index": 0,
            "codec_name": "mpeg2video",
            "codec_long_name": "MPEG-2 video",
            "profile": "4:2:2",
            "codec_type": "video",
            "codec_time_base": "1/25",
            "codec_tag_string": "[0][0][0][0]",
            "codec_tag": "0x0000",
            "width": 720,
            "height": 608,
            "coded_width": 0,
            "coded_height": 0,
            "has_b_frames": 0,
            "sample_aspect_ratio": "608:405",
            "display_aspect_ratio": "16:9",
            "pix_fmt": "yuv422p",
            "level": 5,
            "color_range": "tv",
            "chroma_location": "topleft",
            "field_order": "tt",
            "refs": 1,
            "r_frame_rate": "25/1",
            "avg_frame_rate": "25/1",
            "time_base": "1/25",
            "start_pts": 0,
            "start_time": "0.000000",
            "duration_ts": 3950,
            "duration": "158.000000",
            "bit_rate": "50000000",
            "disposition": {
                "default": 0,
                "dub": 0,
                "original": 0,
                "comment": 0,
                "lyrics": 0,
                "karaoke": 0,
                "forced": 0,
                "hearing_impaired": 0,
                "visual_impaired": 0,
                "clean_effects": 0,
                "attached_pic": 0,
                "timed_thumbnails": 0
            },
            "tags": {
                "file_package_umid": "0x060A2B340101010501010D2013000000CAFDF925E1AF4320A6AADD96B59EB206"
            }
*/

export function makeAudioStreams(clipData: ClipData): object[] {
    const streams: object[] = []
    if (clipData.AudioFormats === '') {
        throw new Error('Cannot make audio stream metadata with an empty video format.')
    }
    let audioFormat = clipData.VideoFormats.split(' ').map(x => +x).sort().reverse()[0]
    let noOfStreams = audioFormat === 522 ? 4 : 1 
    for ( let index = 1 ; index <= noOfStreams ; index++ ) {
        streams.push({
            "index": index,
            "codec_name": audioFormat === 521 ? "pcm_s16le" : "pcm_s24le",
            "codec_long_name": `PCM signed ${audioFormat === 521 ? 16 : 24}-bit little-endian`,
            "codec_type": "audio",
            "codec_time_base": "1/48000",
            "codec_tag_string": "[0][0][0][0]",
            "codec_tag": "0x0000",
            "sample_fmt": audioFormat === 521 ? "s16": "s32",
            "sample_rate": "48000",
            "channels": audioFormat === 521 ? 4 : (audioFormat === 522 ? 1 : 8),
            "bits_per_sample": audioFormat === 521 ? 16: 24,
            "r_frame_rate": "0/0",
            "avg_frame_rate": "0/0",
            "time_base": "1/48000",
            "start_pts": 0,
            "start_time": "0.000000",
            "duration_ts": +clipData.Frames * 1920,
            "duration": `"${+clipData.Frames / 25}"`,
            "bit_rate": `"${audioFormat === 521 ? 3072000 : (audioFormat === 522 ? 1152000 : 9216000)}"`,
            "bits_per_raw_sample": "24",
            "disposition": {
                "default": 0,
                "dub": 0,
                "original": 0,
                "comment": 0,
                "lyrics": 0,
                "karaoke": 0,
                "forced": 0,
                "hearing_impaired": 0,
                "visual_impaired": 0,
                "clean_effects": 0,
                "attached_pic": 0,
                "timed_thumbnails": 0
            },
            "tags": {
            }
        })
    }
        
    return streams
}

/*
        {
            "index": 1,
            "codec_name": "pcm_s24le",
            "codec_long_name": "PCM signed 24-bit little-endian",
            "codec_type": "audio",
            "codec_time_base": "1/48000",
            "codec_tag_string": "[0][0][0][0]",
            "codec_tag": "0x0000",
            "sample_fmt": "s32",
            "sample_rate": "48000",
            "channels": 8,
            "bits_per_sample": 24,
            "r_frame_rate": "0/0",
            "avg_frame_rate": "0/0",
            "time_base": "1/48000",
            "start_pts": 0,
            "start_time": "0.000000",
            "duration_ts": 7584000,
            "duration": "158.000000",
            "bit_rate": "9216000",
            "bits_per_raw_sample": "24",
            "disposition": {
                "default": 0,
                "dub": 0,
                "original": 0,
                "comment": 0,
                "lyrics": 0,
                "karaoke": 0,
                "forced": 0,
                "hearing_impaired": 0,
                "visual_impaired": 0,
                "clean_effects": 0,
                "attached_pic": 0,
                "timed_thumbnails": 0
            },
            "tags": {
                "file_package_umid": "0x060A2B340101010501010D2013000000CAFDF925E1AF4320A6AADD96B59EB206"
            }
        }
    ],
*/

function makeFormat(clipData: ClipData): object {
    if (clipData.AudioFormats === '') {
        throw new Error('Cannot make audio stream metadata with an empty video format.')
    }
    let audioFormat = clipData.VideoFormats.split(' ').map(x => +x).sort().reverse()[0]

    return  {
        "filename": `quantel:${clipData.ClipGUID}`,
        "nb_streams": audioFormat === 522 ? 5 : 2,
        "nb_programs": 0,
        "format_name": "mxf",
        "format_long_name": "MXF (Material eXchange Format)",
        "start_time": "0.000000",
        "duration": `"${+clipData.Frames / 25}"`,
        "size": "563125504",
        "bit_rate": "150166801",
        "probe_score": 100,
        "tags": {
            "operational_pattern_ul": "060e2b34.04010101.0d010201.01010900",
            "company_name": "QUANTEL",
            "product_name": "Media Transformer",
            "product_version": "V7.2.2",
            "application_platform": "Sony MXF Development Kit (Win32)",
            "product_uid": "b4d908cf-53d5-4b41-91a4-82e018e69daa",
            "modification_date": clipData.Modified,
            "timecode": "00:00:00:00"
        }
    }
}

export function mapClipMetadata(clipData: ClipData): object {
    return {
        "streams": [
            {
                "index": 0,
                "codec_name": "h264",
                "codec_long_name": "H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10",
                "profile": "High 4:2:2 Intra",
                "codec_type": "video",
                "codec_time_base": "1/50",
                "codec_tag_string": "[0][0][0][0]",
                "codec_tag": "0x0000",
                "width": 1920,
                "height": 1080,
                "coded_width": 1920,
                "coded_height": 1088,
                "has_b_frames": 0,
                "sample_aspect_ratio": "1:1",
                "display_aspect_ratio": "16:9",
                "pix_fmt": "yuv422p10le",
                "level": 41,
                "color_range": "tv",
                "color_space": "bt709",
                "color_transfer": "bt709",
                "color_primaries": "bt709",
                "chroma_location": "left",
                "field_order": "tt",
                "refs": 1,
                "is_avc": "false",
                "nal_length_size": "0",
                "r_frame_rate": "25/1",
                "avg_frame_rate": "25/1",
                "time_base": "1/25",
                "start_pts": 0,
                "start_time": "0.000000",
                "duration_ts": 750,
                "duration": "30.000000",
                "bits_per_raw_sample": "10",
                "disposition": {
                    "default": 0,
                    "dub": 0,
                    "original": 0,
                    "comment": 0,
                    "lyrics": 0,
                    "karaoke": 0,
                    "forced": 0,
                    "hearing_impaired": 0,
                    "visual_impaired": 0,
                    "clean_effects": 0,
                    "attached_pic": 0,
                    "timed_thumbnails": 0
                },
                "tags": {
                    "file_package_umid": "0x060A2B340101010501010D2313000000A4F7AAD913974963B188093425F35074"
                }
            },
            {
                "index": 1,
                "codec_name": "pcm_s24le",
                "codec_long_name": "PCM signed 24-bit little-endian",
                "codec_type": "audio",
                "codec_time_base": "1/48000",
                "codec_tag_string": "[0][0][0][0]",
                "codec_tag": "0x0000",
                "sample_fmt": "s32",
                "sample_rate": "48000",
                "channels": 1,
                "bits_per_sample": 24,
                "r_frame_rate": "0/0",
                "avg_frame_rate": "0/0",
                "time_base": "1/48000",
                "start_pts": 0,
                "start_time": "0.000000",
                "duration_ts": 1440000,
                "duration": "30.000000",
                "bit_rate": "1152000",
                "bits_per_raw_sample": "24",
                "disposition": {
                    "default": 0,
                    "dub": 0,
                    "original": 0,
                    "comment": 0,
                    "lyrics": 0,
                    "karaoke": 0,
                    "forced": 0,
                    "hearing_impaired": 0,
                    "visual_impaired": 0,
                    "clean_effects": 0,
                    "attached_pic": 0,
                    "timed_thumbnails": 0
                },
                "tags": {
                    "file_package_umid": "0x060A2B340101010501010D2313000000A4F7AAD913974963B188093425F35074"
                }
            },
            {
                "index": 2,
                "codec_name": "pcm_s24le",
                "codec_long_name": "PCM signed 24-bit little-endian",
                "codec_type": "audio",
                "codec_time_base": "1/48000",
                "codec_tag_string": "[0][0][0][0]",
                "codec_tag": "0x0000",
                "sample_fmt": "s32",
                "sample_rate": "48000",
                "channels": 1,
                "bits_per_sample": 24,
                "r_frame_rate": "0/0",
                "avg_frame_rate": "0/0",
                "time_base": "1/48000",
                "start_pts": 0,
                "start_time": "0.000000",
                "duration_ts": 1440000,
                "duration": "30.000000",
                "bit_rate": "1152000",
                "bits_per_raw_sample": "24",
                "disposition": {
                    "default": 0,
                    "dub": 0,
                    "original": 0,
                    "comment": 0,
                    "lyrics": 0,
                    "karaoke": 0,
                    "forced": 0,
                    "hearing_impaired": 0,
                    "visual_impaired": 0,
                    "clean_effects": 0,
                    "attached_pic": 0,
                    "timed_thumbnails": 0
                },
                "tags": {
                    "file_package_umid": "0x060A2B340101010501010D2313000000A4F7AAD913974963B188093425F35074"
                }
            },
            {
                "index": 3,
                "codec_name": "pcm_s24le",
                "codec_long_name": "PCM signed 24-bit little-endian",
                "codec_type": "audio",
                "codec_time_base": "1/48000",
                "codec_tag_string": "[0][0][0][0]",
                "codec_tag": "0x0000",
                "sample_fmt": "s32",
                "sample_rate": "48000",
                "channels": 1,
                "bits_per_sample": 24,
                "r_frame_rate": "0/0",
                "avg_frame_rate": "0/0",
                "time_base": "1/48000",
                "start_pts": 0,
                "start_time": "0.000000",
                "duration_ts": 1440000,
                "duration": "30.000000",
                "bit_rate": "1152000",
                "bits_per_raw_sample": "24",
                "disposition": {
                    "default": 0,
                    "dub": 0,
                    "original": 0,
                    "comment": 0,
                    "lyrics": 0,
                    "karaoke": 0,
                    "forced": 0,
                    "hearing_impaired": 0,
                    "visual_impaired": 0,
                    "clean_effects": 0,
                    "attached_pic": 0,
                    "timed_thumbnails": 0
                },
                "tags": {
                    "file_package_umid": "0x060A2B340101010501010D2313000000A4F7AAD913974963B188093425F35074"
                }
            },
            {
                "index": 4,
                "codec_name": "pcm_s24le",
                "codec_long_name": "PCM signed 24-bit little-endian",
                "codec_type": "audio",
                "codec_time_base": "1/48000",
                "codec_tag_string": "[0][0][0][0]",
                "codec_tag": "0x0000",
                "sample_fmt": "s32",
                "sample_rate": "48000",
                "channels": 1,
                "bits_per_sample": 24,
                "r_frame_rate": "0/0",
                "avg_frame_rate": "0/0",
                "time_base": "1/48000",
                "start_pts": 0,
                "start_time": "0.000000",
                "duration_ts": 1440000,
                "duration": "30.000000",
                "bit_rate": "1152000",
                "bits_per_raw_sample": "24",
                "disposition": {
                    "default": 0,
                    "dub": 0,
                    "original": 0,
                    "comment": 0,
                    "lyrics": 0,
                    "karaoke": 0,
                    "forced": 0,
                    "hearing_impaired": 0,
                    "visual_impaired": 0,
                    "clean_effects": 0,
                    "attached_pic": 0,
                    "timed_thumbnails": 0
                },
                "tags": {
                    "file_package_umid": "0x060A2B340101010501010D2313000000A4F7AAD913974963B188093425F35074"
                }
            }
        ],
        "format": {
            "filename": "http://oaqhttp01//quantel/homezone/clips/ports/751247/essence.mxf",
            "nb_streams": 5,
            "nb_programs": 0,
            "format_name": "mxf",
            "format_long_name": "MXF (Material eXchange Format)",
            "start_time": "0.000000",
            "duration": "30.000000",
            "size": "563125504",
            "bit_rate": "150166801",
            "probe_score": 100,
            "tags": {
                "operational_pattern_ul": "060e2b34.04010101.0d010201.01010900",
                "uid": "3f007aed-1d2d-44ea-b636-569c6ba55890",
                "generation_uid": "35fccab8-3aca-48b5-9c14-4fa1dff0ed8b",
                "company_name": "QUANTEL",
                "product_name": "Media Transformer",
                "product_version": "V7.2.2",
                "application_platform": "Sony MXF Development Kit (Win32)",
                "product_uid": "b4d908cf-53d5-4b41-91a4-82e018e69daa",
                "modification_date": "2020-06-15T15:15:45.000000Z",
                "material_package_umid": "0x060A2B340101010501010D231300000057F39B0910704F37843F1DB13402FB4A",
                "timecode": "00:00:00:00"
            }
        }
    }
}