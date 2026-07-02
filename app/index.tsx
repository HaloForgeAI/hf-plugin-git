import { definePlugin, registerPlugin } from "@haloforge/plugin-sdk";
import { GitPanel } from "./GitPanel";
import "./theme.css";

registerPlugin("dev.haloforge.git", definePlugin({ panel: GitPanel }));
