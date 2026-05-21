package config

import (
	"fmt"
	"os"

	"github.com/BurntSushi/toml"
)

type Server struct {
	Port      int    `toml:"port"`
	SecretKey string `toml:"secret_key"`
	DBPath    string `toml:"db_path"`
}

type TenantConfig struct {
	Name   string `toml:"name"`
	Domain string `toml:"domain"`
}

type Config struct {
	Server  Server         `toml:"server"`
	Tenants []TenantConfig `toml:"tenants"`
}

func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config: %w", err)
	}
	var cfg Config
	if err := toml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}
	if cfg.Server.Port == 0 {
		cfg.Server.Port = 8080
	}
	if cfg.Server.DBPath == "" {
		cfg.Server.DBPath = "bloggy.db"
	}
	// Allow the DB path to be overridden without changing config.toml —
	// useful when running in Docker with a mounted volume.
	if v := os.Getenv("BLOGGY_DB_PATH"); v != "" {
		cfg.Server.DBPath = v
	}
	if cfg.Server.SecretKey == "" {
		return nil, fmt.Errorf("server.secret_key must be set in config")
	}
	return &cfg, nil
}
