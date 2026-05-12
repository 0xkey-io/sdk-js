export interface DemoConfig {
  ui?: {
    themeMode?: "light" | "dark" | "auto";
    light?: {
      background: string;
      text: string;
      panelBackground: string;
      draggableBackground: string;
    };
    dark?: {
      background: string;
      text: string;
      panelBackground: string;
      draggableBackground: string;
    };
  };
}
