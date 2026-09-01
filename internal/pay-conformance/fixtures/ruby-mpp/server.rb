# frozen_string_literal: true

require "json"
require "socket"
require "openssl"
require "timeout"
require "mpp-rb"

cert_dir = ARGV.fetch(0)
tcp = TCPServer.new("127.0.0.1", 0)
context = OpenSSL::SSL::SSLContext.new
context.min_version = OpenSSL::SSL::TLS1_2_VERSION
context.cert = OpenSSL::X509::Certificate.new(File.binread(File.join(cert_dir, "server.pem")))
context.key = OpenSSL::PKey.read(File.binread(File.join(cert_dir, "server.key")))
listener = OpenSSL::SSL::SSLServer.new(tcp, context)

class SyntheticFacilitator
  attr_reader :verify_count, :settle_count
  def initialize
    @verify_count = 0
    @settle_count = 0
  end
  def payer(payload)
    payload.dig("payload", "authorization", "from") || payload.dig("accepted", "payload", "authorization", "from")
  end
  def verify(payload, _requirements)
    @verify_count += 1
    {"isValid" => true, "payer" => payer(payload)}
  end
  def settle(payload, _requirements)
    @settle_count += 1
    {"success" => true, "transaction" => "0x#{"cd" * 32}", "network" => "eip155:84532", "payer" => payer(payload)}
  end
end

facilitator = SyntheticFacilitator.new
method = Mpp::Methods::Evm.charge(
  currency: Mpp::Methods::Evm::Assets::BASE_SEPOLIA_USDC,
  recipient: "0x1111111111111111111111111111111111111111",
  x402: {facilitator: facilitator}
)
handler = Mpp.create(methods: [method], realm: "127.0.0.1:#{tcp.addr[1]}", secret_key: "01234567890123456789012345678901")
puts JSON.generate({type: "ready", port: tcp.addr[1], version: Gem.loaded_specs.fetch("mpp-rb").version.to_s})
STDOUT.flush

def send_response(socket, status, headers, body)
  reason = status == 200 ? "OK" : "Payment Required"
  bytes = body.to_s.b
  merged = {"Content-Length" => bytes.bytesize.to_s, "Connection" => "close"}.merge(headers)
  socket.write("HTTP/1.1 #{status} #{reason}\r\n")
  merged.each do |name, value|
    Array(value).each { |item| socket.write("#{name}: #{item}\r\n") }
  end
  socket.write("\r\n")
  socket.write(bytes)
end

requests = 0
paid = 0
Timeout.timeout(30) do
  2.times do
    socket = listener.accept
    begin
      request_line = socket.gets("\n", 4096)&.strip
      raise "invalid request" unless request_line&.start_with?("GET /paid HTTP/1.1")
      headers = {}
      while (line = socket.gets("\n", 8192))
        line = line.strip
        break if line.empty?
        name, value = line.split(":", 2)
        headers[name.downcase] = value.to_s.strip
      end
      requests += 1
      url = "https://#{headers.fetch("host")}/paid"
      result = handler.charge(headers["authorization"], "0.01", description: "Final 7C Ruby EVM seller", payment_signature: headers["payment-signature"], url: url, http_method: "GET")
      if result.is_a?(Mpp::Challenge)
        response = handler.challenge_response(result, url: url, http_method: "GET")
        send_response(socket, response.fetch("status"), response.fetch("headers"), response.fetch("body"))
      else
        credential, receipt = result
        response_headers = {"Payment-Receipt" => receipt.to_payment_receipt, "Content-Type" => "application/json"}
        method.decorate_receipt(response_headers, receipt, credential, payment_signature: headers["payment-signature"])
        paid += 1
        send_response(socket, 200, response_headers, JSON.generate({ok: true}))
      end
    ensure
      socket.close
    end
  end
end
raise "unexpected counts" unless [requests, paid, facilitator.verify_count, facilitator.settle_count] == [2, 1, 1, 1]
puts JSON.generate({type: "PASSED", requests: requests, paid: paid, verify: facilitator.verify_count, settle: facilitator.settle_count})
STDOUT.flush
tcp.close
