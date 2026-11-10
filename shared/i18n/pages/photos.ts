import { photosEn } from './photos.en.ts'
import { photosZhTW } from './photos.zh-TW.ts'
import { registerPageCatalog } from './register.ts'

// Imported for its effect by src/pages/photos/PhotosPage.tsx (the page's lazy entry): registers the page's
// keys when its chunk loads, before the page renders.
registerPageCatalog(photosZhTW, photosEn)
