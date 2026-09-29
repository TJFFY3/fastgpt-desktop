import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { DockerClient } from "../src/docker-client";
import { ImageService } from "../src/image-service";
export function engineFixture(){const client=new DockerClient(process.env.FASTGPT_DOCKER_CLI??(process.platform==="darwin"?join(homedir(),".docker/bin/docker"):"/usr/bin/docker"));const images=new ImageService({client,assetDirectory:resolve("packages/sandbox/image"),stateDirectory:resolve(".superpowers/sandbox-integration/image")});return {client,images};}
