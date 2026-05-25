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
	if v := os.Getenv("BLOGGY_SECRET_KEY"); v != "" {
		cfg.Server.SecretKey = v
	}
	const defaultPlaceholder = "change-me-to-a-random-32-char-secret!!"
	switch cfg.Server.SecretKey {
	case "":
		return nil, fmt.Errorf("server.secret_key must be set (or use BLOGGY_SECRET_KEY env var)")
	case defaultPlaceholder:
		return nil, fmt.Errorf("server.secret_key is still the default placeholder — set a real random secret")
	}
	return &cfg, nil
}
