import {
  faCheck,
  faGripLines,
  faPalette,
  faUserLock,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

import { Draggable, DragDropContext, Droppable } from "@hello-pangea/dnd";
import { useZeroXKeyConfig } from "./ConfigProvider";
import { ToggleSwitch } from "@/components/Switch";
import { SliderField } from "@/components/Slider";
import { ColourPicker } from "@/components/Color";
import { PanelDisclosure } from "@/components/Disclosure";
import { useEffect } from "react";
import { ZeroXKeyProviderConfig } from "@0xkey-io/react-wallet-kit";
import { completeTheme, textColour } from "@/utils";
import { Button, Checkbox } from "@headlessui/react";
import { DemoConfig } from "@/types";
import {
  AppleSVG,
  DiscordSVG,
  FacebookSVG,
  GoogleSVG,
  TwitterXSVG,
} from "@/components/Svg";

const omitKeys = [
  "apiBaseUrl",
  "authProxyUrl",
  "importIframeUrl",
  "exportIframeUrl",
  "googleClientId",
  "appleClientId",
  "facebookClientId",
  "oauthRedirectUri",
  "walletConfig",
  "renderModalInProvider",
  "oauthOrder",
  "organizationId",
  "authProxyConfigId",
  "createSuborgParams",
  "autoRefreshSession",
  "oauthConfig",
  "autoFetchWalletKitConfig",
  "autoRefreshManagedState",
];

const defaultDarkSurface = {
  modalBackground: "#111216",
  modalText: "#f5f7fb",
  button: "#202124",
  iconBackground: "#202124",
  iconText: "#ffffff",
};

interface AuthMethod {
  name: string;
  toggles: {
    toggle: string;
    overrideDisplayName?: string;
    icon?: React.FC<React.SVGProps<SVGSVGElement>>;
    comingSoon?: boolean;
  }[];
  order: "socials" | "email" | "sms" | "passkey" | "wallet";
  comingSoon?: boolean;
}

const authMethods: AuthMethod[] = [
  {
    name: "OAuth",
    toggles: [
      {
        overrideDisplayName: "Google",
        toggle: "googleOauthEnabled",
        icon: GoogleSVG,
      },
      {
        overrideDisplayName: "Apple",
        toggle: "appleOauthEnabled",
        icon: AppleSVG,
        // Coming soon: keep Apple OAuth wiring available but hidden in the demo.
        comingSoon: true,
      },
      {
        overrideDisplayName: "Facebook",
        toggle: "facebookOauthEnabled",
        icon: FacebookSVG,
      },
      {
        overrideDisplayName: "X (Twitter)",
        toggle: "xOauthEnabled",
        icon: TwitterXSVG,
      },
      {
        overrideDisplayName: "Discord",
        toggle: "discordOauthEnabled",
        icon: DiscordSVG,
      },
    ],
    order: "socials",
  },
  {
    name: "Email OTP",
    toggles: [{ toggle: "emailOtpAuthEnabled" }],
    order: "email",
  },
  {
    name: "SMS OTP",
    toggles: [{ toggle: "smsOtpAuthEnabled" }],
    order: "sms",
    // Coming soon: keep SMS OTP wiring available but hidden in the demo.
    comingSoon: true,
  },
  {
    name: "Passkey",
    toggles: [{ toggle: "passkeyAuthEnabled" }],
    order: "passkey",
  },
  {
    name: "Wallet",
    toggles: [{ toggle: "walletAuthEnabled" }],
    order: "wallet",
  },
];

export function ZeroXKeyConfigPanel() {
  const { config, demoConfig, initialConfig, setConfig } = useZeroXKeyConfig();

  const handleDragEnd = (result: any) => {
    if (!result.destination) return;

    const currentOrder = config.auth?.methodOrder ?? [];
    const reordered = Array.from(currentOrder);
    const [moved] = reordered.splice(result.source.index, 1);
    reordered.splice(result.destination.index, 0, moved);

    handleSetConfig({
      auth: {
        ...config.auth,
        methodOrder: reordered,
      },
    });
  };

  const visibleAuthMethods = authMethods.filter((method) => !method.comingSoon);

  const handleSetConfig = async (
    newConfig: Partial<ZeroXKeyProviderConfig>,
    newDemoConfig?: Partial<DemoConfig>,
  ) => {
    setConfig({ ...config, ...newConfig }, { ...demoConfig, ...newDemoConfig });
    storeConfig(
      { ...config, ...newConfig },
      { ...demoConfig, ...newDemoConfig },
    );
  };

  const themeMode =
    demoConfig.ui?.themeMode ?? (config.ui?.darkMode ? "dark" : "light");

  const handleThemeModeChange = (
    mode: NonNullable<DemoConfig["ui"]>["themeMode"],
  ) => {
    const systemDark =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;

    handleSetConfig(
      {
        ui: {
          ...config.ui,
          darkMode: mode === "auto" ? systemDark : mode === "dark",
        },
      },
      {
        ui: {
          ...demoConfig.ui,
          themeMode: mode,
        },
      },
    );
  };

  // Store config in local storage
  const storeConfig = (
    config: Partial<ZeroXKeyProviderConfig>,
    demoConfig?: Partial<DemoConfig>,
  ) => {
    // store everything but the omitted keys in local storage
    const filteredConfig = Object.fromEntries(
      Object.entries(config).filter(([key]) => !omitKeys.includes(key)),
    );

    localStorage.setItem("0xkeyConfig", JSON.stringify(filteredConfig));
    localStorage.setItem("0xkeyDemoConfig", JSON.stringify(demoConfig));
  };

  useEffect(() => {
    // Load config from local storage
    const loadConfig = () => {
      const storedConfig = localStorage.getItem("0xkeyConfig");
      const storedDemoConfig = localStorage.getItem("0xkeyDemoConfig");
      if (storedConfig) {
        const parsedConfig = JSON.parse(storedConfig);
        const storedDark = parsedConfig.ui?.colors?.dark ?? {};
        setConfig({
          ...parsedConfig,
          auth: {
            ...parsedConfig.auth,
            methodOrder: (parsedConfig.auth?.methodOrder ?? []).filter(
              (method: string) => method !== "sms",
            ),
            methods: {
              ...parsedConfig.auth?.methods,
              // Coming soon: keep code paths intact, but do not expose these demo methods yet.
              appleOauthEnabled: false,
              smsOtpAuthEnabled: false,
            },
          },
          ui: {
            ...parsedConfig.ui,
            colors: {
              ...parsedConfig.ui?.colors,
              dark: {
                ...storedDark,
                ...defaultDarkSurface,
                primary: storedDark.primary ?? "#335bf9",
                primaryText: storedDark.primaryText ?? "#ffffff",
              },
            },
          },
        });
      }
      if (storedDemoConfig) {
        setConfig({}, JSON.parse(storedDemoConfig));
      }
    };
    loadConfig();
  }, []);

  return (
    <div className="space-y-11 overflow-y-auto zeroxkey-scrollbar pr-1">
      {/* Auth Methods with Reordering & Toggle */}
      <PanelDisclosure
        icon={<FontAwesomeIcon icon={faUserLock} />}
        title="Auth"
      >
        <DragDropContext onDragEnd={handleDragEnd}>
          <Droppable droppableId="methodOrder">
            {(provided) => (
              <div
                ref={provided.innerRef}
                {...provided.droppableProps}
                className="space-y-2"
              >
                {(config.auth?.methodOrder ?? [])
                  .filter((methodKey) =>
                    visibleAuthMethods.some(
                      (method) => method.order === methodKey,
                    ),
                  )
                  .map((methodKey, index) => {
                    const method = visibleAuthMethods.find(
                      (m) => m.order === methodKey,
                    )!;
                    const activeToggles = method.toggles.filter(
                      (toggle) => !toggle.comingSoon,
                    );
                    const someEnabled = activeToggles.some(
                      (key) =>
                        config.auth?.methods?.[
                          key.toggle as keyof typeof config.auth.methods
                        ] ?? false,
                    );
                    return (
                      <Draggable
                        key={method.order}
                        draggableId={method.order}
                        index={index}
                      >
                        {(provided) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            {...provided.dragHandleProps}
                            className="bg-draggable-background-light dark:bg-draggable-background-dark px-3 py-2 rounded shadow-sm space-y-2"
                          >
                            <div className="flex flex-row gap-2 items-center">
                              <FontAwesomeIcon icon={faGripLines} />
                              {/* Top Row: Name + Master Toggle */}
                              <div className="flex-1">
                                <ToggleSwitch
                                  label={method.name}
                                  checked={someEnabled}
                                  onChange={(val) => {
                                    const newToggles = activeToggles.reduce(
                                      (acc, { toggle }) => {
                                        acc[toggle] = val;
                                        return acc;
                                      },
                                      {} as Record<string, boolean>,
                                    );

                                    handleSetConfig({
                                      auth: {
                                        ...config.auth,
                                        methods: {
                                          ...config.auth?.methods,
                                          ...newToggles,
                                        },
                                      },
                                    });
                                  }}
                                />
                              </div>
                            </div>

                            {/* Individual Toggles */}
                            {activeToggles.length > 1 && (
                              <div className="flex flex-col justify-between mt-3 w-full">
                                {activeToggles.map((toggleKey) => {
                                  const isChecked =
                                    config.auth?.methods?.[
                                      toggleKey.toggle as keyof typeof config.auth.methods
                                    ] ?? false;
                                  return (
                                    <Checkbox
                                      key={toggleKey.toggle}
                                      className="flex justify-between items-center cursor-pointer py-1.5"
                                      checked={isChecked}
                                      onChange={(val: boolean) =>
                                        handleSetConfig({
                                          auth: {
                                            ...config.auth,
                                            methods: {
                                              ...config.auth?.methods,
                                              [toggleKey.toggle]: val,
                                            },
                                          },
                                        })
                                      }
                                    >
                                      <p className="flex items-center">
                                        {toggleKey?.icon && (
                                          <toggleKey.icon className="mr-3 size-5.5" />
                                        )}
                                        {toggleKey?.overrideDisplayName ||
                                          toggleKey.toggle}
                                      </p>
                                      <div
                                        className={`rounded-md flex items-center justify-center size-5.5 border-2 ${isChecked ? "bg-primary-light dark:bg-primary-dark border-transparent" : "bg-transparent border-primary-text-light dark:border-primary-text-dark"} transition-colors`}
                                      >
                                        <FontAwesomeIcon
                                          icon={faCheck}
                                          className={`size-4 text-primary-text-light dark:text-primary-text-dark ${isChecked ? "" : "invisible"}`}
                                        />
                                      </div>
                                    </Checkbox>
                                  );
                                })}

                                {method.name === "OAuth" && (
                                  <>
                                    <div className="w-full my-3 h-[1px] bg-icon-text-light dark:bg-icon-text-dark" />
                                    <ToggleSwitch
                                      label="Open OAuth In Page"
                                      size="sm"
                                      checked={
                                        config.auth?.oauthConfig
                                          ?.openOauthInPage ?? false
                                      }
                                      onChange={(val) =>
                                        handleSetConfig({
                                          auth: {
                                            ...config.auth,
                                            oauthConfig: {
                                              ...config.auth?.oauthConfig,
                                              openOauthInPage: val,
                                            },
                                          },
                                        })
                                      }
                                    />
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </Draggable>
                    );
                  })}

                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
      </PanelDisclosure>

      {/* UI Toggles */}
      <PanelDisclosure title="UI" icon={<FontAwesomeIcon icon={faPalette} />}>
        <>
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm font-medium">Theme</span>
            <div className="grid grid-cols-3 rounded-xl bg-icon-background-light p-1 text-sm dark:bg-icon-background-dark">
              {(["light", "dark", "auto"] as const).map((mode) => (
                <Button
                  key={mode}
                  onClick={() => handleThemeModeChange(mode)}
                  className={`min-w-20 rounded-lg px-4 py-2 font-medium capitalize transition-colors ${
                    themeMode === mode
                      ? "bg-modal-background-light text-primary-light shadow-sm dark:bg-modal-background-dark dark:text-primary-dark"
                      : "text-icon-text-light/70 hover:text-icon-text-light dark:text-icon-text-dark/70 dark:hover:text-icon-text-dark"
                  }`}
                >
                  {mode}
                </Button>
              ))}
            </div>
          </div>
          <ColourPicker
            label="Primary Color"
            value={
              !config.ui?.darkMode
                ? config.ui?.colors?.light?.primary || "#000000"
                : config.ui?.colors?.dark?.primary || "#000000"
            }
            onChange={(val) => {
              const primaryText = textColour(val);
              handleSetConfig({
                ui: {
                  ...config.ui,
                  colors: !config.ui?.darkMode
                    ? {
                        ...config.ui?.colors,
                        light: {
                          ...config.ui?.colors?.light,
                          primary: val,
                          primaryText,
                        },
                      }
                    : {
                        ...config.ui?.colors,
                        dark: {
                          ...config.ui?.colors?.dark,
                          primary: val,
                          primaryText,
                        },
                      },
                },
              });
            }}
          />
          <ColourPicker
            label="Primary Background"
            value={
              !config.ui?.darkMode
                ? config.ui?.colors?.light?.modalBackground || "#000000"
                : config.ui?.colors?.dark?.modalBackground || "#000000"
            }
            onChange={(val) => {
              const newColors = completeTheme(val);

              handleSetConfig(
                {
                  ui: {
                    ...config.ui,
                    colors: !config.ui?.darkMode
                      ? {
                          ...config.ui?.colors,
                          light: {
                            ...config.ui?.colors?.light,
                            modalBackground: val,
                            modalText: textColour(val, true),
                            iconBackground: newColors.iconBackground,
                            iconText: newColors.iconText,
                            button: newColors.buttonBackground,
                          },
                        }
                      : {
                          ...config.ui?.colors,
                          dark: {
                            ...config.ui?.colors?.dark,
                            modalBackground: val,
                            modalText: textColour(val, true),
                            iconBackground: newColors.iconBackground,
                            iconText: newColors.iconText,
                            button: newColors.buttonBackground,
                          },
                        },
                  },
                },
                {
                  ui: !config.ui?.darkMode
                    ? {
                        ...demoConfig.ui,
                        light: {
                          background: newColors.background,
                          text: textColour(newColors.background, true),
                          panelBackground: newColors.panelBackground,
                          draggableBackground: newColors.draggableBackground,
                        },
                      }
                    : {
                        ...demoConfig.ui,
                        dark: {
                          background: newColors.background,
                          text: textColour(newColors.background, true),
                          panelBackground: newColors.panelBackground,
                          draggableBackground: newColors.draggableBackground,
                        },
                      },
                },
              );
            }}
          />

          <SliderField
            label="Border Radius"
            min={0}
            max={48}
            step={2}
            suffix="px"
            value={config.ui?.borderRadius as number}
            onChange={(val) =>
              handleSetConfig({
                ui: {
                  ...config.ui,
                  borderRadius: val || 0,
                },
              })
            }
          />

          <ToggleSwitch
            label="Large Action Buttons"
            checked={config.ui?.preferLargeActionButtons ?? false}
            onChange={(val) =>
              handleSetConfig({
                ui: {
                  ...config.ui,
                  preferLargeActionButtons: val,
                },
              })
            }
          />
        </>
      </PanelDisclosure>
      <Button
        className="w-full hover:cursor-pointer p-2 text-sm rounded-md bg-primary-light dark:bg-primary-dark text-primary-text-light dark:text-primary-text-dark hover:bg-primary-light/90 dark:hover:bg-primary-dark/90 transition-colors"
        onClick={() => {
          handleSetConfig(initialConfig, {
            ui: undefined,
          });
        }}
      >
        Reset to Defaults
      </Button>
    </div>
  );
}
