import HaloService from "../service";
import SiteStore from "../utils/site-store";

export default async () => {
  const siteStore = new SiteStore();
  const service = new HaloService(siteStore.getDefaultSite());
  await service.uploadImages();
};
