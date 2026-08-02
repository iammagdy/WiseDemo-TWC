export async function executeShieldedNavigationAction(input: {
  checkpointBefore: string;
  checkpointAfter: string;
  assertPrivacyShield: (checkpoint: string) => Promise<void>;
  action: () => Promise<void>;
  waitForTransition: () => Promise<void>;
}): Promise<void> {
  await input.assertPrivacyShield(input.checkpointBefore);
  await input.action();
  await input.waitForTransition();
  await input.assertPrivacyShield(input.checkpointAfter);
}
