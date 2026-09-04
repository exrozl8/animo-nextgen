import aniwatch from 'aniwatch';
const { HiAnime } = aniwatch;
const hianime = new HiAnime.Scraper();

async function run() {
  try {
    console.log("Searching HiAnime for: One Piece");
    const results = await hianime.search("One Piece");
    if (results.animes && results.animes.length > 0) {
      const anime = results.animes[0];
      console.log("Found:", anime.name);
      
      const episodes = await hianime.getEpisodes(anime.id);
      if (episodes.episodes && episodes.episodes.length > 0) {
        const ep = episodes.episodes[0];
        console.log("Fetching sources for ep ID:", ep.episodeId);
        const stream = await hianime.getEpisodeSources(ep.episodeId);
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
