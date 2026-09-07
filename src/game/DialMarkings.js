// A small engraved stroke alphabet keeps the instruments procedural and
// legible without loading font files or adding another material/shader path.
const strokes = {
  N: [[[0, 0], [0, 1], [.6, 0], [.6, 1]]],
  E: [[[.6, 1], [0, 1], [0, 0], [.6, 0]], [[0, .5], [.5, .5]]],
  S: [[[.6, 1], [0, 1], [0, .5], [.6, .5], [.6, 0], [0, 0]]],
  W: [[[0, 1], [.1, 0], [.3, .45], [.5, 0], [.6, 1]]],
  K: [[[0, 0], [0, 1]], [[.6, 1], [0, .45], [.6, 0]]],
  0: [[[0, 0], [0, 1], [.6, 1], [.6, 0], [0, 0]]],
  1: [[[.1, .8], [.3, 1], [.3, 0]], [[.1, 0], [.5, 0]]],
  2: [[[0, 1], [.6, 1], [.6, .5], [0, .5], [0, 0], [.6, 0]]],
  5: [[[.6, 1], [0, 1], [0, .5], [.6, .5], [.6, 0], [0, 0]]]
};

export function dialStrokes(text) {
  const width = text.length * .85 - .25;
  return [...text].flatMap((letter, i) => (strokes[letter] || []).flatMap(path => path.slice(1).map((end, j) =>
    [path[j], end].map(([x, y]) => [x + i * .85 - width / 2, y - .5]))));
}
