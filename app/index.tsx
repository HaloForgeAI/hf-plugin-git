import { definePlugin, registerPlugin } from "@haloforge/plugin-sdk";
import { GitPanel } from "./GitPanel";

registerPlugin("dev.haloforge.git", definePlugin({ panel: GitPanel }));
