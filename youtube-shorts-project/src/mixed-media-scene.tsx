import { makeScene2D, Img, Video, Layout, Txt, View2D, Audio } from '@revideo/2d';
import { createRef, all, chain, waitFor, Reference, createSignal } from '@revideo/core';
import dataRaw from './mixed-media-data.json';
import { Theme } from './types';

// Interfaces
interface Word {
    punctuated_word: string;
    start: number;
    end: number;
}

interface Segment {
    type: 'ORIGINAL_VIDEO' | 'AI_IMAGE' | 'AI_VIDEO';
    duration: number;
    prompt?: string;
    src?: string; // For images
}

interface MixedMediaData {
    startTime: string;
    totalDuration: number;
    sourceVideo?: string;
    extractedAudio?: string;
    words?: Word[];
    segments: Segment[];
    theme?: Theme; // Optional theme from Brand Kit
}

interface CaptionSettings {
    fontSize: number;
    textColor: string;
    fontWeight: number;
    fontFamily: string;
    numSimultaneousWords: number;
    textAlign: "center" | "left";
    textBoxWidthInPercent: number;
    borderColor?: string;
    borderWidth?: number;
    currentWordColor?: string;
    shadowColor?: string;
    shadowBlur?: number;
    fadeInAnimation?: boolean;
}

const textSettings: CaptionSettings = {
    fontSize: 70, // Increased for better legibility on mobile
    numSimultaneousWords: 3,
    textColor: "white",
    fontWeight: 900, // Extra bold
    fontFamily: "Mulish",
    textAlign: "center",
    textBoxWidthInPercent: 85,
    fadeInAnimation: true,
    currentWordColor: "#FFD700",
    shadowColor: "black",
    shadowBlur: 30 // Stronger shadow for better contrast
};

// Ensure the imported JSON matches our interface
const data = dataRaw as MixedMediaData;

export default makeScene2D('mixed-media-scene', function* (view) {
    // Parse start time "HH:MM:SS" to seconds for seeking
    const [hours, minutes, seconds] = data.startTime.split(':').map(Number);
    const startTimeSeconds = hours * 3600 + minutes * 60 + seconds;

    const videoRef = createRef<Video>();
    const textContainer = createRef<Layout>();

    // Apply Brand Theme if available
    const effectiveSettings: CaptionSettings = {
        ...textSettings,
        ...(data.theme ? {
            textColor: data.theme.textColor,
            fontFamily: data.theme.fontFamily,
            currentWordColor: data.theme.accentColor,
            // We could also use primary/secondary colors for other things
        } : {})
    };

    view.add(
        <>
            {data.sourceVideo && (
                <Video
                    ref={videoRef}
                    src={data.sourceVideo.startsWith('/') ? data.sourceVideo : `/${data.sourceVideo}`}
                    size={'100%'}
                    play={true}
                    time={startTimeSeconds}
                />
            )}
            {data.extractedAudio && (
                <Audio
                    src={data.extractedAudio.startsWith('/') ? data.extractedAudio : `/${data.extractedAudio}`}
                    play={true}
                    time={0}
                />
            )}
            <Layout
                size={"100%"}
                ref={textContainer}
                zIndex={1000} // Ensure text is on top
                y={500} // Positioned in lower third (safe zone)
            />
        </>
    );

    // Parallel execution: Text Display + Asset Overlays
    yield* all(
        displayMediaOverlay(view, data.segments),
        displayWords(textContainer, data.words || [], effectiveSettings), // Use effectiveSettings
        waitFor(data.totalDuration)
    );
});

function* displayMediaOverlay(view: View2D, segments: Segment[]) {
    // Iterate responsibly through segments to manage overlays
    // We need to wait for each segment's duration

    for (const segment of segments) {
        if ((segment.type === 'AI_IMAGE' || segment.type === 'AI_VIDEO') && segment.src) {
            const isVideo = segment.src.toLowerCase().endsWith('.mp4');

            if (isVideo) {
                const vidRef = createRef<Video>();
                view.add(
                    <Video
                        ref={vidRef}
                        src={segment.src}
                        width={'100%'}
                        height={'100%'}
                        opacity={0}
                        scale={1}
                        play={true}
                        loop={true}
                    />
                );

                // Fade in
                yield* vidRef().opacity(1, 0.5);

                // Wait for duration (minus fade out time)
                yield* waitFor(segment.duration - 0.5);

                // Fade out
                yield* vidRef().opacity(0, 0.5);
                vidRef().remove();

            } else {
                // Create an image overlay
                const imgRef = createRef<Img>();

                view.add(
                    <Img
                        ref={imgRef}
                        src={segment.src}
                        width={'100%'} // Fill width
                        height={'100%'}
                        opacity={0} // Start hidden
                        scale={1}
                    />
                );

                yield* imgRef().opacity(1, 0.5); // Fast fade in

                // Ken Burns Effect (Slow Zoom)
                yield* all(
                    imgRef().scale(1.1, segment.duration),
                    waitFor(segment.duration - 0.5) // Wait for duration minus fade times
                );

                yield* imgRef().opacity(0, 0.5); // Fade out
                imgRef().remove(); // Cleanup
            }

        } else {
            // It's ORIGINAL_VIDEO.
            // We just wait, letting the base video layer show.
            yield* waitFor(segment.duration);
        }
    }
}

// function displayWords (to be updated in next step after viewing)ntainer: Reference<Layout>, words: Word[], settings: CaptionSettings) {
function* displayWords(container: Reference<Layout>, words: Word[], settings: CaptionSettings) {
    if (!words || words.length === 0) return;

    let currentTime = 0;

    // Filter words to match the clip time range potentially?
    // The timestamps from AssemblyAI are relative to the audio file.
    // Since we extracted audio matching the clip exactly, timestamps start at 0.

    for (let i = 0; i < words.length; i += settings.numSimultaneousWords) {
        const currentBatch = words.slice(i, i + settings.numSimultaneousWords);
        const startOfBatch = currentBatch[0].start;
        const waitBefore = Math.max(0, startOfBatch - currentTime);

        yield* waitFor(waitBefore);
        currentTime += waitBefore;

        const textRef = createRef<Txt>();

        yield container().add(
            <Txt
                width={`${settings.textBoxWidthInPercent}%`}
                textAlign={settings.textAlign}
                ref={textRef}
                textWrap={true}
            />
        );

        const wordRefs: Reference<Txt>[] = [];
        const opacitySignal = createSignal(settings.fadeInAnimation ? 0.5 : 1);

        for (let j = 0; j < currentBatch.length; j++) {
            const word = currentBatch[j];
            const optionalSpace = j === currentBatch.length - 1 ? "" : " ";
            const wordRef = createRef<Txt>();

            textRef().add(
                <Txt
                    fontSize={settings.fontSize}
                    fontWeight={settings.fontWeight}
                    ref={wordRef}
                    fontFamily={settings.fontFamily}
                    textWrap={true}
                    textAlign={settings.textAlign}
                    fill={settings.textColor}
                    stroke={settings.borderColor}
                    lineWidth={settings.borderWidth}
                    shadowBlur={settings.shadowBlur}
                    shadowColor={settings.shadowColor}
                    opacity={opacitySignal}
                >
                    {word.punctuated_word}
                </Txt>
            );
            textRef().add(<Txt fontSize={settings.fontSize}>{optionalSpace}</Txt>);
            wordRefs.push(wordRef);
        }

        const endOfBatch = currentBatch[currentBatch.length - 1].end;

        yield* all(
            opacitySignal(1, 0.2),
            highlightCurrentWord(currentBatch, wordRefs, settings.currentWordColor!),
        );

        textRef().remove();
        currentTime = endOfBatch;
    }
}

function* highlightCurrentWord(currentBatch: Word[], wordRefs: Reference<Txt>[], wordColor: string) {
    for (let i = 0; i < currentBatch.length; i++) {
        const word = currentBatch[i];
        const wordRef = wordRefs[i];

        if (i > 0) {
            const prevWord = currentBatch[i - 1];
            const gap = word.start - prevWord.end;
            if (gap > 0) {
                yield* waitFor(gap);
            }
        }

        const originalColor = wordRef().fill();

        const duration = word.end - word.start;

        // Dynamic transition time: use 0.1s or half the duration if word is very short
        // This ensures the animation total time exactly matches the word duration
        const transitionDuration = Math.min(0.1, duration / 2);

        // Smooth transition to highlight color
        yield* all(
            wordRef().fill(wordColor, transitionDuration),
            wordRef().scale(1.2, transitionDuration)
        );

        const holdDuration = duration - (2 * transitionDuration);
        if (holdDuration > 0) {
            yield* waitFor(holdDuration);
        }

        // Smooth transition back to original
        yield* all(
            wordRef().fill(originalColor, transitionDuration),
            wordRef().scale(1, transitionDuration)
        );
    }
}
