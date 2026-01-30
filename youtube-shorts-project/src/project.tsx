import { Audio, Video, Img, makeScene2D, Txt, Rect, Layout } from '@revideo/2d';
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
  numSimultaneousWords: 4,
  textColor: "white",
  fontWeight: 800,
  fontFamily: "Mulish",
  stream: false,
  textAlign: "center",
  textBoxWidthInPercent: 70,
  fadeInAnimation: true,
  currentWordColor: "#FFD700",
  shadowColor: "black",
  shadowBlur: 30
}

const scene = makeScene2D('scene', function* (view) {
  const mediaAssets = useScene().variables.get('mediaAssets', [])();
  const legacyVideos = useScene().variables.get('videos', [])();
  const legacyImages = useScene().variables.get('images', [])();

  const finalMedia = mediaAssets.length > 0 ? mediaAssets : (legacyVideos.length > 0 ? legacyVideos : legacyImages);

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
    displayMedia(imageContainer, finalMedia, duration),
    displayWords(
      textContainer,
      words,
      textSettings
    )
  )
});

function* displayMedia(container: Reference<Layout>, mediaFiles: string[], totalDuration: number) {
  const durationPerItem = totalDuration / mediaFiles.length;
  const fadeDuration = 1.0;

  for (let i = 0; i < mediaFiles.length; i++) {
    const file = mediaFiles[i];
    const isVideo = file.toLowerCase().endsWith('.mp4');
    const ref = createRef<Layout>();

    container().add(
      <Layout ref={ref} size={['100%', '100%']} opacity={0} zIndex={i}>
        {isVideo ? (
          <Video
            src={file}
            size={["100%", "100%"]}
            play={true}
            loop={true}
          />
        ) : (
          <Img
            src={file}
            size={["100%", "100%"]}
          />
        )}
      </Layout>
    );

    yield* ref().opacity(1, fadeDuration);
    yield* waitFor(durationPerItem - fadeDuration);
  }
}

function* displayWords(container: Reference<Layout>, words: Word[], settings: captionSettings) {
  let currentTime = 0;

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
        zIndex={1000}
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
    const durationOfBatch = endOfBatch - startOfBatch;

    yield* all(
      opacitySignal(1, 0.2),
      highlightCurrentWord(container, currentBatch, wordRefs, settings.currentWordColor!),
    );

    textRef().remove();
    currentTime = endOfBatch;
  }
}

function* highlightCurrentWord(container: Reference<Layout>, currentBatch: Word[], wordRefs: Reference<Txt>[], wordColor: string) {
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
    wordRef().fill(wordColor);
    wordRef().scale(1.1, 0.1);

    const duration = word.end - word.start;
    yield* waitFor(duration);

    wordRef().fill(originalColor);
    wordRef().scale(1, 0.1);
  }
}

export default makeProject({
  scenes: [scene],
  variables: metadata,
  settings: {
    shared: {
      size: { x: 1080, y: 1920 },
    },
  },
});
