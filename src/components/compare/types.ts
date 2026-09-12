import type { VideoPlayer } from 'expo-video';

import type { ResolvedClip } from '@/types';

/**
 * What every visualization mode needs. The players are created and owned by the
 * screen, so switching modes never tears them down.
 */
export interface CompareModeProps {
  reference: ResolvedClip;
  comparison: ResolvedClip;
  referencePlayer: VideoPlayer;
  comparisonPlayer: VideoPlayer;
  mirrorReference: boolean;
  mirrorComparison: boolean;
}
