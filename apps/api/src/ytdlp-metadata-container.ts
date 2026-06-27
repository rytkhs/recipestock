import { Container } from "@cloudflare/containers";

export class YtDlpMetadataContainer extends Container {
  defaultPort = 8080;
  requiredPorts = [8080];
  sleepAfter = "2m";
  enableInternet = true;
  pingEndpoint = "localhost/health";
}
