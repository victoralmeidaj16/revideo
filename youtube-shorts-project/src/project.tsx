import { Audio, Img, makeScene2D, Txt, Rect, Layout } from '@revideo/2d';
import { all, createRef, waitFor, useScene, Reference, createSignal, makeProject } from '@revideo/core';
import metadata from './metadata.json';
import './global.css';

interface Word {
  punctuated_word: string;
  start: number;
  end: number;
}

interface captionSettings {
  fontSize: number;
  textColor: string;
  fontWeight: number;
  fontFamily: string;
  numSimultaneousWords: number;
  stream: boolean;
  textAlign: "center" | "left";
  textBoxWidthInPercent: number;
  borderColor?: string;
  borderWidth?: number;
  currentWordColor?: string;
  currentWordBackgroundColor?: string;
  shadowColor?: string;
  shadowBlur?: number;
  fadeInAnimation?: boolean;
}

const textSettings: captionSettings = {
  fontSize: 80,
  numSimultaneousWords: 4, // how many words are shown at most simultaneously
  textColor: "white",
  fontWeight: 800,
  fontFamily: "Mulish",
  stream: false, // if true, words appear one by one
  textAlign: "center",
  textBoxWidthInPercent: 70,
  fadeInAnimation: true,
  currentWordColor: "cyan",
  currentWordBackgroundColor: "red", // adds a colored box to the word currently spoken
  shadowColor: "black",
  shadowBlur: 30
}

/**
 * The Revideo scene
 */
const scene = makeScene2D('scene', function* (view) {
  const images = useScene().variables.get('images', [])();
  const audioUrl = useScene().variables.get('audioUrl', 'none')();
  const words = useScene().variables.get('words', [])();

  const duration = words[words.length - 1].end + 0.5;

  const imageContainer = createRef<Layout>();
  const textContainer = createRef<Layout>();

  yield view.add(
    <>
      <Layout
        size={"100%"}
        ref={imageContainer}
      />
      <Layout
        size={"100%"}
        ref={textContainer}
      />
      <Audio
        src={audioUrl}
        play={true}
      />
      <Audio
        src={"https://revideo-example-assets.s3.amazonaws.com/chill-beat-2.mp3"}
        play={true}
        volume={0.1}
      />
    </>
  );

  yield* all(
    displayImages(imageContainer, images, duration),
    displayWords(
      textContainer,
      words,
      textSettings
    )
  )
});

function* displayImages(container: Reference<Layout>, images: string[], totalDuration: number) {
  const durationPerImage = totalDuration / images.length;
  const fadeDuration = 1.0;

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const ref = createRef<Img>();
    // Alternating zoom: Even = Zoom In (1 -> 1.05), Odd = Zoom Out (1.05 -> 1)
    const startScale = i % 2 === 0 ? 1 : 1.05;
    const endScale = i % 2 === 0 ? 1.05 : 1;

    container().add(<Img
      src={img}
      size={["100%", "100%"]}
      ref={ref}
      zIndex={i} // Ensure new images are on top
      scale={startScale}
      opacity={0} // Start invisible for fade in
    />);

    // Animate: Fade In + Continuous Zoom
    yield* all(
      ref().opacity(1, fadeDuration), // Smooth fade in
      ref().scale(endScale, durationPerImage) // Slow zoom effect
    );

    // Wait for the remaining duration of this slide (minus fade time we just yielded? No, 'all' finishes when max duration finishes)
    // Actually 'all' waits for the longest. 
    // We want the next slide to start overlapping or just after?
    // Let's keep it simple: The 'all' above takes 'durationPerImage' (assuming fadeDuration < durationPerImage).
    // So this slide is done.

    // Note: The previous slide is covered by this one (zIndex i).
    // We don't remove previous slides to avoid blips, they are just covered.
  }
}

function* displayWords(container: Reference<Layout>, words: Word[], settings: captionSettings) {
  // Ensure we start checking from time 0, but the first wait depends on the first word
  let currentTime = 0;

  for (let i = 0; i < words.length; i += settings.numSimultaneousWords) {
    const currentBatch = words.slice(i, i + settings.numSimultaneousWords);

    // Calculate wait before this batch appears
    const startOfBatch = currentBatch[0].start;
    const waitBefore = Math.max(0, startOfBatch - currentTime);

    yield* waitFor(waitBefore);
    currentTime += waitBefore;

    const textRef = createRef<Txt>();

    // Display the batch container
    yield container().add(
      <Txt
        width={`${settings.textBoxWidthInPercent}%`}
        textAlign={settings.textAlign}
        ref={textRef}
        textWrap={true}
        zIndex={1000} // High zIndex ensuring visibility over images
      />
    );

    const wordRefs: Reference<Txt>[] = [];
    const opacitySignal = createSignal(settings.fadeInAnimation ? 0.5 : 1);

    // Render words in the batch
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

      // Yield momentarily to allow layout calculation if needed, 
      // though strictly synchronous adding usually works in recent Revideo.
      // We push ref to array for highlighting later.
      wordRefs.push(wordRef);
    }

    // Determine how long this batch stays on screen
    // It stays until the last word ends, OR until the next batch starts (if we want continuous flow)
    // But typically we want it to stay at least until the last word ends.
    const endOfBatch = currentBatch[currentBatch.length - 1].end;
    const durationOfBatch = endOfBatch - startOfBatch;

    // Animate highlighting
    yield* all(
      opacitySignal(1, 0.2), // Quick fade in of full opacity
      highlightCurrentWord(container, currentBatch, wordRefs, settings.currentWordColor, settings.currentWordBackgroundColor),
    );

    // Remove text after batch is done
    textRef().remove();
    currentTime = endOfBatch;
  }
}

function* highlightCurrentWord(container: Reference<Layout>, currentBatch: Word[], wordRefs: Reference<Txt>[], wordColor: string, backgroundColor: string) {
  for (let i = 0; i < currentBatch.length; i++) {
    const word = currentBatch[i];
    const wordRef = wordRefs[i];

    // Handle gap between previous word and current word
    if (i > 0) {
      const prevWord = currentBatch[i - 1];
      const gap = word.start - prevWord.end;
      if (gap > 0) {
        yield* waitFor(gap);
      }
    }

    // Highlight
    const originalColor = wordRef().fill();
    wordRef().fill(wordColor);
    wordRef().scale(1.1, 0.1); // Subtle pop effect

    // Wait until word ends
    const duration = word.end - word.start;
    yield* waitFor(duration);

    // Unhighlight
    wordRef().fill(originalColor);
    wordRef().scale(1, 0.1);
  }
}

/**
 * The final revideo project
 */
export default makeProject({
  scenes: [scene],
  variables: metadata,
  settings: {
    shared: {
      size: { x: 1080, y: 1920 },
    },
  },
});
