/**
 * Jest setup. The pure-logic suites (timeline math, signal processing, offset
 * solving) need no native mocks — that is deliberate: all analysis code is kept
 * free of native dependencies so it can be tested on plain Node.
 */
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(async () => {}),
  selectionAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

// AsyncStorage has no native backend under Jest; its maintained in-memory mock
// keeps the persisted stores behaving like the real thing.
jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
