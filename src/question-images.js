export const questionImageBucket = 'question-images';

const imagePath = /^(?:\.\/)?question-images\/([a-f0-9-]{36}\.(?:png|jpg|webp|gif|avif))$/;

export function questionImageName(path) {
  return imagePath.exec(path)?.[1];
}
