/**
 * Live playhead readout.
 *
 * Subscribes to the transport directly instead of receiving time as a prop, so
 * the ~30 Hz updates re-render this label alone and never the video surfaces.
 */

import { useEffect, useState } from 'react';

import { Text } from '@/components/ui';
import { formatTimecode } from '@/playback/timeline';
import type { SyncedPlayback } from '@/playback/useSyncedPlayback';
import { colors } from '@/theme';

interface TimecodeProps {
  transport: SyncedPlayback;
  /** Also show the total duration, as `current / total`. */
  showTotal?: boolean;
}

export function Timecode({ transport, showTotal = true }: TimecodeProps) {
  const [time, setTime] = useState(() => transport.getTime());

  useEffect(() => transport.subscribeTime(setTime), [transport]);

  return (
    <Text variant="mono" color={colors.textMuted}>
      {formatTimecode(time - transport.timeline.start)}
      {showTotal ? ` / ${formatTimecode(transport.timeline.duration)}` : ''}
    </Text>
  );
}
