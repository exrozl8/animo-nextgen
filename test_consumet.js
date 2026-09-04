import { META } from '@consumet/extensions';
const anilist = new META.Anilist();

async function run() {
  try {
    console.log("Fetching anime info for Anilist ID 21 (One Piece)...");
    const info = await anilist.fetchAnimeInfo("21");
    console.log("Episodes found:", info.episodes?.length);
    
    if (info.episodes && info.episodes.length > 0) {
      const ep = info.episodes.find(e => e.number === 1) || info.episodes[0];
      console.log("Fetching sources for episode ID:", ep.id);
      const stream = await anilist.fetchEpisodeSources(ep.id);
      console.log("Stream sources:", JSON.stringify(stream.sources, null, 2));
    }
  } catch(e) {
    console.error("Error:", e);
  }
}
run();
