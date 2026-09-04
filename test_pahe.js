import { ANIME } from '@consumet/extensions';
const pahe = new ANIME.AnimePahe();

async function run() {
  try {
    const query = "One Piece";
    console.log("Searching AnimePahe for:", query);
    const results = await pahe.search(query);
    if (results.results && results.results.length > 0) {
      const anime = results.results[0];
      console.log("Found:", anime.title);
      
      const info = await pahe.fetchAnimeInfo(anime.id);
      if (info.episodes && info.episodes.length > 0) {
        const ep = info.episodes[0];
        console.log("Fetching sources for ep ID:", ep.id);
        const stream = await pahe.fetchEpisodeSources(ep.id);
        console.log("Stream sources:", JSON.stringify(stream.sources, null, 2));
      }
    } else {
      console.log("No results");
    }
  } catch(e) {
    console.error("Error:", e);
  }
}
run();
