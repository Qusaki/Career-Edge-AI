import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const header = app.slice(app.indexOf('{/* Navbar */}'), app.indexOf('<main className=', app.indexOf('{/* Navbar */}')));

test('landing header keeps the brand and both authentication actions without section links or a menu', () => {
  assert.match(header, /<nav\b[\s\S]*?Career Edge/);
  assert.match(header, /onClick=\{\(\) => openAuth\('signin'\)\}[\s\S]*?>Sign In<\/button>/);
  assert.match(header, /onClick=\{\(\) => openAuth\('signup'\)\}[\s\S]*?Get Started[\s\S]*?<\/button>/);
  assert.doesNotMatch(header, /Features|How it Works|Contact|About|href="#|landing-mobile-menu|Open main menu/);
  assert.doesNotMatch(app, /isMenuOpen|setIsMenuOpen/);
});

test('landing header exposes its actions at mobile and desktop widths with visible keyboard focus', () => {
  assert.match(header, /flex h-20 items-center justify-between gap-2 px-4 sm:px-6/);
  assert.match(header, /flex shrink-0 items-center gap-2 sm:gap-4/);
  assert.equal((header.match(/focus-visible:outline-brand-gold-light/g) ?? []).length, 2);
  assert.equal((header.match(/min-h-11 whitespace-nowrap/g) ?? []).length, 2);
  assert.doesNotMatch(header, /hidden md:flex|md:hidden/);
});

test('landing sections remain in the document for normal scrolling', () => {
  assert.match(app, /<section id="features"/);
  assert.match(app, /<section id="campus-map"/);
  assert.match(app, /\{\/\* Hero Section \*\/\}/);
});
