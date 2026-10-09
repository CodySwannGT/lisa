# Genuine local SQL proves every role and least privilege; no provider or issuer acceptance.
require "mysql2"
require "json"

roles = %w[test queue_test cache_test cable_test]
observations = roles.map do |role|
  database = "#{ENV.fetch('DATABASE_NAME')}_#{role}"
  client = Mysql2::Client.new(host: ENV.fetch("PRIMARY_DB_HOST"), port: Integer(ENV.fetch("DATABASE_PORT")), username: ENV.fetch("DATABASE_USER"), password: ENV.fetch("DATABASE_PASSWORD"), database: database)
  raise "physical schema differs" unless client.query("SELECT DATABASE() AS name").first.fetch("name") == database
  client.query("INSERT INTO runtime_witnesses(payload) VALUES ('owned-native-hook')")
  raise "native row missing" unless client.query("SELECT COUNT(*) AS total FROM runtime_witnesses WHERE payload='owned-native-hook'").first.fetch("total") == 1
  denied = false
  begin
    client.query("SELECT User FROM mysql.user")
  rescue Mysql2::Error => error
    denied = error.error_number == 1142
  end
  raise "administrator access accepted" unless denied
  client.close
  { role: role, physical_schema: true, native_rows: 1, administrator_read_denied: true }
end
File.open("hook-observation.json", File::WRONLY | File::CREAT | File::EXCL, 0o600) do |file|
  file.write(JSON.generate(observations))
end
