(function () {
  'use strict';

  if (window.__igScraperLoaded) return;
  window.__igScraperLoaded = true;

  let isRunning = false;

  const EXCLUDED = new Set([
    'p', 'reel', 'reels', 'explore', 'stories', 'accounts', 'about',
    'legal', 'privacy', 'help', 'press', 'api', 'directory', 'locations',
    'hashtag', 'tv', 'direct', 'challenge', 'login', 'register', 'oauth',
    'graphql', 'static', 'embed', 'web', 'lite', 'blog', 'popular',
    'developer', 'support', 'safety', 'features', 'business', 'creators',
  ]);

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  function getPostAuthor(article) {
    const header = article.querySelector('header');
    if (!header) return null;
    for (const a of header.querySelectorAll('a[href]')) {
      try {
        const m = new URL(a.href).pathname.match(/^\/([A-Za-z0-9._]{1,30})\/?$/);
        if (m && !EXCLUDED.has(m[1].toLowerCase())) return m[1].toLowerCase();
      } catch { /* skip */ }
    }
    return null;
  }

  function extractCommenters() {
    // Scope to <article> — excludes the global nav sidebar (own username lives there)
    const article = document.querySelector('article');
    if (!article) return [];

    const seen = new Set();

    // Pre-exclude the post author so they're skipped even in the caption area
    const postAuthor = getPostAuthor(article);
    if (postAuthor) seen.add(postAuthor);

    const commenters = [];

    for (const a of article.querySelectorAll('a[href]')) {
      // <header>  → post author row
      // <section> → action bar + "liked by X" + comment input
      // <footer>  → unlikely but safe to skip
      if (a.closest('header, section, footer, nav')) continue;

      // Avatar links wrap an <img> — these appear in "liked by" and nav, not comments
      if (a.querySelector('img')) continue;

      try {
        const { hostname, pathname } = new URL(a.href);
        if (!hostname.endsWith('instagram.com')) continue;

        const m = pathname.match(/^\/([A-Za-z0-9._]{1,30})\/?$/);
        if (!m) continue;

        const username = m[1];
        const key = username.toLowerCase();
        if (EXCLUDED.has(key)) continue;
        if (seen.has(key)) continue;

        seen.add(key);
        commenters.push({ username });
      } catch { /* skip invalid URLs */ }
    }

    return commenters;
  }

  async function clickLoadMoreComments() {
    for (const el of document.querySelectorAll('button, [role="button"]')) {
      const text = el.textContent.trim().toLowerCase();
      if (text === 'load more comments' || text === 'view more comments') {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        el.click();
        return true;
      }
    }
    return false;
  }

  function decodeHTMLEntities(str) {
    const ta = document.createElement('textarea');
    ta.innerHTML = str;
    return ta.value;
  }

  async function fetchFullName(username) {
    try {
      const res = await fetch(`https://www.instagram.com/${username}/`, {
        credentials: 'include',
      });
      if (!res.ok) return null;
      const html = await res.text();
      // og:title format: "Full Name (@username) • Instagram photos and videos"
      const m = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/);
      if (!m) return null;
      const namePart = decodeHTMLEntities(m[1]).split('(')[0].trim();
      if (!namePart || namePart.toLowerCase() === username.toLowerCase()) return null;
      return namePart;
    } catch {
      return null;
    }
  }

  async function run(includeRealNames) {
    if (isRunning) return;
    isRunning = true;

    try {
      let pagesLoaded = 0;
      let missStreak  = 0;

      while (missStreak < 3) {
        const clicked = await clickLoadMoreComments();

        if (clicked) {
          pagesLoaded++;
          missStreak = 0;
          chrome.runtime.sendMessage({
            action: 'progress',
            text: `Yorumlar taranıyor... (batch ${pagesLoaded} loaded)`,
          });
          await sleep(1800);
        } else {
          missStreak++;
          if (missStreak < 3) await sleep(800);
        }
      }

      chrome.runtime.sendMessage({ action: 'progress', text: 'Yorumcular çıkarılıyor...' });

      const commenters = extractCommenters();

      if (includeRealNames) {
        for (let i = 0; i < commenters.length; i++) {
          chrome.runtime.sendMessage({
            action: 'progress',
            text: `İsimler alınıyor... (${i + 1}/${commenters.length})`,
          });
          const fullName = await fetchFullName(commenters[i].username);
          if (fullName) commenters[i].full_name = fullName;
          if (i < commenters.length - 1) await sleep(400);
        }
      }

      chrome.runtime.sendMessage({
        action: 'done',
        commenters,
        postUrl: window.location.href,
      });
    } catch (err) {
      chrome.runtime.sendMessage({ action: 'error', text: `Error: ${err.message}` });
    } finally {
      isRunning = false;
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'scrape') run(msg.includeRealNames);
    sendResponse({});
    return true;
  });
})();
