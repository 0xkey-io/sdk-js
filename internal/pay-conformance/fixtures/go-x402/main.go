package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	x402 "github.com/x402-foundation/x402/go/v2"
	x402http "github.com/x402-foundation/x402/go/v2/http"
	exactevm "github.com/x402-foundation/x402/go/v2/mechanisms/evm/exact/client"
	evmsigners "github.com/x402-foundation/x402/go/v2/signers/evm"
)

func fail(err error) { if err != nil { panic(err) } }

func main() {
	if len(os.Args) != 3 { panic("usage: go-x402 URL CA") }
	u, caPath := os.Args[1], os.Args[2]
	if !strings.HasPrefix(u, "https://127.0.0.1:") { panic("non-loopback URL") }
	ca, err := os.ReadFile(caPath); fail(err)
	pool := x509.NewCertPool(); if !pool.AppendCertsFromPEM(ca) { panic("invalid CA") }
	dialer := &net.Dialer{Timeout: 5 * time.Second}
	transport := &http.Transport{Proxy: nil, TLSClientConfig: &tls.Config{RootCAs: pool, MinVersion: tls.VersionTLS12}, DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
		if !strings.HasPrefix(address, "127.0.0.1:") { return nil, fmt.Errorf("egress rejected: %s", address) }
		return dialer.DialContext(ctx, network, address)
	}, TLSHandshakeTimeout: 5 * time.Second, ResponseHeaderTimeout: 10 * time.Second}
	signer, err := evmsigners.NewClientSignerFromPrivateKey("0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"); fail(err)
	client := x402.Newx402Client().Register(x402.Network("eip155:*"), exactevm.NewExactEvmScheme(signer, nil))
	httpClient := x402http.Newx402HTTPClient(client)
	paid := x402http.WrapHTTPClientWithPayment(&http.Client{Transport: transport, Timeout: 15 * time.Second}, httpClient)
	response, err := paid.Get(u); fail(err); defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 65537)); fail(err)
	if response.StatusCode != 200 || len(body) > 65536 || response.Header.Get("PAYMENT-RESPONSE") == "" { panic("payment response invalid") }
	var decoded map[string]any; fail(json.Unmarshal(body, &decoded)); if decoded["ok"] != true { panic("body invalid") }
	json.NewEncoder(os.Stdout).Encode(map[string]any{"status":"PASSED", "runtime": strings.TrimSpace(runtimeVersion()), "httpStatus":response.StatusCode, "paymentResponse":true})
}

func runtimeVersion() string { return "go-official-x402" }
