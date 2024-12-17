import Preferences = require("preferences");

export interface Site {
  url: string;
  pat: string;
  default: boolean;
}

const PREFERENCES_KEY = "run.halo.vscode";
const SITES_KEY = "sites";

class SiteStore {
  private readonly preferences: Preferences;

  constructor() {
    this.preferences = new Preferences(PREFERENCES_KEY);
  }

  private set(key: string, value: unknown) {
    this.preferences[key] = value;
    this.preferences.save();
  }

  private get(key: string) {
    return this.preferences[key];
  }

  public getDefaultSite(): Site | undefined {
    const sites = this.getSites();

    return sites?.find((site) => site.default);
  }

  public getSite(url: string): Site | undefined {
    const sites = this.getSites();

    return sites?.find((site) => site.url === url);
  }

  public getSites(): Site[] | undefined {
    return this.get(SITES_KEY);
  }

  public registerSite(site: Site) {
    const sites = this.getSites() || [];

    if (sites.length === 0) {
      sites.push(site);
      this.set(SITES_KEY, sites);
      return;
    }

    for (const site of sites) {
      site.default = false;
    }

    // Currently only support one site
    sites[0] = site;

    this.set(SITES_KEY, sites);
  }
}

export default SiteStore;
