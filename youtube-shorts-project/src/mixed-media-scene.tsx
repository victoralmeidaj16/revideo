import { makeScene2D, Img, Video, Layout } from '@revideo/2d';
import { createRef, all, chain, waitFor } from '@revideo/core';
import dataRaw from './mixed-media-data.json';

// Interface for our generated data
interface Segment {
    type: 'ORIGINAL_VIDEO' | 'AI_IMAGE';
    duration: number;
    prompt?: string;
    src?: string; // For images
}

interface MixedMediaData {
    startTime: string;
    totalDuration: number;
    segments: Segment[];
}

// Ensure the imported JSON matches our interface
const data = dataRaw as MixedMediaData;

export default makeScene2D('mixed-media-scene', function* (view) {
    // Parse start time "HH:MM:SS" to seconds for seeking
    const [hours, minutes, seconds] = data.startTime.split(':').map(Number);
    const startTimeSeconds = hours * 3600 + minutes * 60 + seconds;

    const videoRef = createRef<Video>();

    // We keep the main video in the background/layer 0
    // It handles the audio and the video segments.
    // For Image segments, we overlay the image on top.

    view.add(
        <Video
            ref={videoRef}
            src="/mitos_e_verdades_sobre_a_tcc (360p).mp4" // Served from public/
            size={'100%'}
            play={true}
            time={startTimeSeconds} // Seek to start
        />
    );

    // Iterate responsibly through segments to manage overlays
    let currentOffset = 0;

    for (const segment of data.segments) {
        if (segment.type === 'AI_IMAGE' && segment.src) {
            // Create an image overlay
            const imgRef = createRef<Img>();

            view.add(
                <Img
                    ref={imgRef}
                    src={segment.src}
                    width={'100%'} // Fill width
                    // height auto to maintain aspect ratio, but we might want 'cover'
                    // For vertical video, let's assume 1080x1920 or similar
                    height={'100%'}
                    opacity={0} // Start hidden
                    scale={1}
                />
            );

            // Fade in / Show logic
            // Since video is continuous, we just show the image ON TOP of it during this segment
            // Pause video? No, we likely want the audio to continue from the video file.
            // So we just overlay the image.

            yield* imgRef().opacity(1, 0.5); // Fast fade in

            // Ken Burns Effect (Slow Zoom)
            yield* all(
                imgRef().scale(1.1, segment.duration),
                waitFor(segment.duration - 0.5) // Wait for duration minus fade times
            );

            yield* imgRef().opacity(0, 0.5); // Fade out
            imgRef().remove(); // Cleanup

        } else {
            // It's ORIGINAL_VIDEO.
            // We just wait, letting the base video layer show.
            yield* waitFor(segment.duration);
        }

        currentOffset += segment.duration;
    }
});
