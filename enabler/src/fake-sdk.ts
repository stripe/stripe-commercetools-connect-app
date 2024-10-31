
/**
 * Represents a fake SDK.
 */
export class FakeSdk {
  private environment: string;

  /**
   * Creates an instance of FakeSdk.
   * @param environment - The environment for the SDK.
   */
  constructor({ environment }) {
    this.environment = environment;
    console.log('FakeSdk constructor', this.environment);
  }

  /**
   * Initializes the SDK with the specified options.
   * @param opts - The options for initializing the SDK.
   */
  init(opts: any) {
    console.log('FakeSdk init', opts);
  }
}
