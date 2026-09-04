import { ANIME } from '@consumet/extensions';
const gogo = new ANIME.Gogoanime();

async function run() {
  try {
    const query = "One Piece";
    console.log("Searching Gogoanime for:", query);
    const results = await gogo.search(query);
    if (results.results && results.results.length > 0) {
      const anime = results.results[0];
      console.log("Found:", anime.title);
      
      const info = await gogo.fetchAnimeInfo(anime.id);
      if (info.episodes && info.episodes.length > 0) {
        const ep = info.episodes[0];
        console.log("Fetching sources for ep ID:", ep.id);
        const stream = await gogo.fetchEpisodeSources(ep.id);
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
