import Parser from 'rss-parser';
import fetch from 'node-fetch';
import { config } from './config.js';

const parser = new Parser({
  headers: { 'User-Agent': config.rss.userAgent },
  timeout: 15000,
});

export function buildFeedUrl() {
  return config.rss.url;
}

export async function fetchFeed(feedUrl = config.rss.url) {
  const feed = await parser.parseURL(feedUrl);
  const items = (feed.items || []).map((item) => ({
    title: item.title || '',
    link: item.link || '',
    guid: item.guid || item.link || '',
    pubDate: item.pubDate ? new Date(item.pubDate) : null,
    enclosure: item.enclosure ? { url: item.enclosure.url, type: item.enclosure.type } : null,
  }));
  return items;
}

export function filterTrusted(items, groups = config.processing.trustedGroups) {
  const trust = new Set(groups.map((g) => g.toLowerCase()));
  return items.filter((item) => {
    const title = item.title;
    const groupToken = title.match(/^(\[[^\]]+\]|[[A-Za-z0-9.]+)/);
    let g = groupToken ? groupToken[1].toLowerCase() : '';
    if (g.startsWith('[') && g.endsWith(']')) g = g.slice(1, -1).toLowerCase();
    return trust.has(g);
  });
}
