import { Aniwatch } from 'aniwatch';

async function run() {
  try {
    const ani = new Aniwatch();
    const query = "One Piece";
    console.log("Searching aniwatch for:", query);
    const results = await ani.search(query);
    if (results.animes && results.animes.length > 0) {
      const anime = results.animes[0];
      console.log("Found:", anime.name);
      
      const episodes = await ani.getEpisodes(anime.id);
      if (episodes.episodes && episodes.episodes.length > 0) {
        const ep = episodes.episodes[0];
        console.log("Fetching sources for ep ID:", ep.episodeId);
        const stream = await ani.getEpisodeSources(ep.episodeId);
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
