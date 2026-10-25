// The two families the app's stylesheet asks for by name. Loading them under
// their real family names means the injected app CSS resolves them unchanged.
// Weights and subset are pinned to what the app actually uses; without that,
// Remotion fetches every Inter weight and variant on every render.
import {loadFont as loadAnton} from '@remotion/google-fonts/Anton';
import {loadFont as loadInter} from '@remotion/google-fonts/Inter';

loadAnton('normal', {subsets: ['latin'], weights: ['400']});
loadInter('normal', {subsets: ['latin'], weights: ['400', '500', '600', '700', '800']});
