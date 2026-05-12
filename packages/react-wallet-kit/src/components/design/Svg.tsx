interface SVGProps {
  className?: string;
  style?: React.CSSProperties;
}

export function CoinbaseLogo(props: SVGProps) {
  return (
    <svg
      viewBox="0 0 1024 1024"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <rect width="1024" height="1024" fill="#0052FF" rx="100" ry="100"></rect>
      <path
        fill-rule="evenodd"
        clip-rule="evenodd"
        d="M152 512C152 710.823 313.177 872 512 872C710.823 872 872 710.823 872 512C872 313.177 710.823 152 512 152C313.177 152 152 313.177 152 512ZM420 396C406.745 396 396 406.745 396 420V604C396 617.255 406.745 628 420 628H604C617.255 628 628 617.255 628 604V420C628 406.745 617.255 396 604 396H420Z"
        fill="white"
      ></path>
    </svg>
  );
}

export function MoonPayLogo(props: SVGProps) {
  return (
    <svg
      viewBox="0 0 61 61"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <g id="moonpay_symbol_wht 2">
        <rect
          x="1.3374"
          y="1"
          width="59"
          height="59"
          rx="11.5"
          fill="#7715F5"
        ></rect>
        <path
          id="Vector"
          d="M43.8884 23.3258C45.0203 23.3258 46.1268 22.9901 47.068 22.3613C48.0091 21.7324 48.7427 20.8386 49.1759 19.7928C49.6091 18.747 49.7224 17.5962 49.5016 16.4861C49.2807 15.3759 48.7357 14.3561 47.9353 13.5557C47.1349 12.7553 46.1151 12.2102 45.0049 11.9893C43.8947 11.7685 42.7439 11.8819 41.6982 12.3151C40.6524 12.7482 39.7585 13.4818 39.1297 14.423C38.5008 15.3641 38.1651 16.4707 38.1651 17.6026C38.165 18.3542 38.3131 19.0985 38.6007 19.7929C38.8883 20.4873 39.3098 21.1182 39.8413 21.6496C40.3728 22.1811 41.0037 22.6027 41.6981 22.8903C42.3925 23.1778 43.1367 23.3259 43.8884 23.3258ZM26.3395 49.1017C23.5804 49.1017 20.8832 48.2836 18.5891 46.7507C16.295 45.2178 14.5069 43.039 13.4511 40.49C12.3952 37.9409 12.1189 35.1359 12.6572 32.4298C13.1955 29.7237 14.5241 27.238 16.4751 25.287C18.4262 23.336 20.9118 22.0074 23.6179 21.4691C26.324 20.9308 29.129 21.2071 31.6781 22.2629C34.2272 23.3189 36.406 25.1069 37.9389 27.401C39.4717 29.6952 40.2899 32.3923 40.2899 35.1514C40.2899 36.9835 39.9291 38.7975 39.2281 40.49C38.527 42.1826 37.4994 43.7205 36.204 45.0159C34.9086 46.3113 33.3707 47.3389 31.6781 48.04C29.9856 48.741 28.1715 49.1018 26.3395 49.1017Z"
          fill="white"
        ></path>
      </g>
    </svg>
  );
}
export function EthereumLogo(props: SVGProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      xmlSpace="preserve"
      id="Layer_1"
      x={0}
      y={0}
      viewBox="0 0 327.5 533.3"
      {...props}
    >
      <style>{".st0{fill:#8a92b2}.st1{fill:#62688f}"}</style>
      <path d="M163.7 197.2V0L0 271.6l163.7-74.4z" className="st0" />
      <path
        d="M163.7 368.4V197.2L0 271.6l163.7 96.8zm0-171.2 163.7 74.4L163.7 0v197.2z"
        className="st1"
      />
      <path
        d="M163.7 197.2v171.2l163.7-96.8-163.7-74.4z"
        style={{
          fill: "#454a75",
        }}
      />
      <path d="M163.7 399.4 0 302.7l163.7 230.7v-134z" className="st0" />
      <path d="m327.5 302.7-163.8 96.7v134l163.8-230.7z" className="st1" />
    </svg>
  );
}

export function SolanaLogo(props: SVGProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      xmlSpace="preserve"
      viewBox="0 0 397.7 311.7"
      {...props}
    >
      <linearGradient
        id="a"
        x1={360.879}
        x2={141.213}
        y1={351.455}
        y2={-69.294}
        gradientTransform="matrix(1 0 0 -1 0 314)"
        gradientUnits="userSpaceOnUse"
      >
        <stop
          offset={0}
          style={{
            stopColor: "#00ffa3",
          }}
        />
        <stop
          offset={1}
          style={{
            stopColor: "#dc1fff",
          }}
        />
      </linearGradient>
      <path
        d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7z"
        style={{
          fill: "url(#a)",
        }}
      />
      <linearGradient
        id="b"
        x1={264.829}
        x2={45.163}
        y1={401.601}
        y2={-19.148}
        gradientTransform="matrix(1 0 0 -1 0 314)"
        gradientUnits="userSpaceOnUse"
      >
        <stop
          offset={0}
          style={{
            stopColor: "#00ffa3",
          }}
        />
        <stop
          offset={1}
          style={{
            stopColor: "#dc1fff",
          }}
        />
      </linearGradient>
      <path
        d="M64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8z"
        style={{
          fill: "url(#b)",
        }}
      />
      <linearGradient
        id="c"
        x1={312.548}
        x2={92.882}
        y1={376.688}
        y2={-44.061}
        gradientTransform="matrix(1 0 0 -1 0 314)"
        gradientUnits="userSpaceOnUse"
      >
        <stop
          offset={0}
          style={{
            stopColor: "#00ffa3",
          }}
        />
        <stop
          offset={1}
          style={{
            stopColor: "#dc1fff",
          }}
        />
      </linearGradient>
      <path
        d="M333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z"
        style={{
          fill: "url(#c)",
        }}
      />
    </svg>
  );
}

/** Official-style multicolor Google "G" mark for OAuth buttons */
export function GoogleLogoColored(props: SVGProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 48"
      width="24"
      height="24"
      {...props}
    >
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="m6.306 14.691 6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  );
}
