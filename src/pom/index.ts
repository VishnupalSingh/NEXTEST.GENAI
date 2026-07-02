/**
 * Page Object Model — public surface.
 *
 * Tests import page objects from here:
 *   import { DocsHomePage } from '../src/pom';
 *
 * To add a page: create `src/pom/pages/<name>.page.ts` extending BasePage,
 * declare its selectors/locators, then re-export it below.
 */
export { BasePage } from './base-page';
export { DocsHomePage } from './pages/docs-home.page';
export { DocsIntroPage } from './pages/docs-intro.page';
export { DocsDockerPage } from './pages/docs-docker.page';
