// Picks where the catalog lives: GitHub commits (Vercel preview) or the server disk (STORAGE=fs, regular hosting).
import * as github from './github.js';
import * as disk from './fs-store.js';

const backend = () => (process.env.STORAGE === 'fs' ? disk : github);

export const getCatalog = (...args) => backend().getCatalog(...args);
export const saveCatalog = (...args) => backend().saveCatalog(...args);
export const savePhoto = (...args) => backend().savePhoto(...args);
export const savePreview = (...args) => backend().savePreview(...args);
export const deletePhoto = (...args) => backend().deletePhoto(...args);
export const readPrivate = (...args) => backend().readPrivate(...args);
export const writePrivate = (...args) => backend().writePrivate(...args);
