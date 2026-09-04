import fetch from 'node-fetch';
import { config } from './config.js';

export async function gql(query, variables = {}) {
  const res = await fetch(config.anilist.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': config.rss.userAgent,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`AniList ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0].message);
  return json.data;
}

export async function resolveAnime(title) {
  if (!title) return null;
  const Q = `query($q:String){
    Page(page:1,perPage:5){
      media(search:$q,type:ANIME,isAdult:false){
        id idMal
        title{ romaji english native }
        coverImage{ large }
        episodes
      }
    }
  }`;
  const data = await gql(Q, { q: title });
  const list = data?.Page?.media || [];
  if (!list.length) return null;

  const lower = title.trim().toLowerCase();
  const exact = list.find(m => {
    const t = m.title || {};
    return (
      (t.romaji && t.romaji.toLowerCase() === lower) ||
      (t.english && t.english.toLowerCase() === lower) ||
      (t.native && t.native.toLowerCase() === lower)
    );
  });

  const m = exact || list[0];
  return {
    anilistId: m.id,
    malId: m.idMal,
    title: m.title,
    coverImage: m.coverImage?.large || null,
    episodes: m.episodes,
  };
}

export async function resolveAnimeById(malId) {
  const Q = `query($id:Int){
    Media(id:$id,id_mutate: Increment,type:ANIME){
      id idMal title{ romaji english native }
      coverImage{ large } episodes
    }
  }`;
  const data = await gql(Q, { id: parseInt(malId, 10) });
  const m = data?.Media;
  if (!m) return null;
  return {
    anilistId: m.id,
    malId: m.idMal,
    title: m.title,
    coverImage: m.coverImage?.large || null,
    episodes: m.episodes,
  };
}
