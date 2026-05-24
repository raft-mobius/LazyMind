package store

import (
	"context"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"
)

// ScanPath represents a user-registered directory path to be scanned.
type ScanPath struct {
	ID           string     `json:"id"`
	UserID       string     `json:"user_id"`
	Path         string     `json:"path"`
	Status       string     `json:"status"`
	FileCount    int        `json:"file_count"`
	LastScanAt   *time.Time `json:"last_scan_at,omitempty"`
	ErrorMessage string     `json:"error_message"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

// scanPathEntity is the GORM model for the scan_paths table.
type scanPathEntity struct {
	ID           string     `gorm:"column:id;type:text;primaryKey"`
	UserID       string     `gorm:"column:user_id;type:text;not null;index:idx_scan_paths_user_id;uniqueIndex:idx_scan_paths_user_path,priority:1"`
	Path         string     `gorm:"column:path;type:text;not null;uniqueIndex:idx_scan_paths_user_path,priority:2"`
	Status       string     `gorm:"column:status;type:text;not null;default:idle"`
	FileCount    int        `gorm:"column:file_count;not null;default:0"`
	LastScanAt   *time.Time `gorm:"column:last_scan_at"`
	ErrorMessage string     `gorm:"column:error_message;type:text;not null;default:''"`
	CreatedAt    time.Time  `gorm:"column:created_at;not null"`
	UpdatedAt    time.Time  `gorm:"column:updated_at;not null"`
}

func (scanPathEntity) TableName() string { return "scan_paths" }

func scanPathID() string {
	return fmt.Sprintf("sp_%d", time.Now().UnixNano())
}

func toScanPath(e scanPathEntity) *ScanPath {
	return &ScanPath{
		ID:           e.ID,
		UserID:       e.UserID,
		Path:         e.Path,
		Status:       e.Status,
		FileCount:    e.FileCount,
		LastScanAt:   e.LastScanAt,
		ErrorMessage: e.ErrorMessage,
		CreatedAt:    e.CreatedAt,
		UpdatedAt:    e.UpdatedAt,
	}
}

// CreateScanPath inserts a new scan path for the given user.
func (s *Store) CreateScanPath(ctx context.Context, userID, path string) (*ScanPath, error) {
	userID = strings.TrimSpace(userID)
	path = strings.TrimSpace(path)
	if userID == "" {
		return nil, fmt.Errorf("user_id is required")
	}
	if path == "" {
		return nil, fmt.Errorf("path is required")
	}

	now := time.Now().UTC()
	entity := scanPathEntity{
		ID:           scanPathID(),
		UserID:       userID,
		Path:         path,
		Status:       "idle",
		FileCount:    0,
		ErrorMessage: "",
		CreatedAt:    now,
		UpdatedAt:    now,
	}

	if err := s.db.WithContext(ctx).Create(&entity).Error; err != nil {
		if isUniqueConstraintError(err) {
			return nil, fmt.Errorf("scan path already exists for user %s: %s", userID, path)
		}
		return nil, err
	}

	return toScanPath(entity), nil
}

// ListScanPaths returns all scan paths for the given user.
func (s *Store) ListScanPaths(ctx context.Context, userID string) ([]*ScanPath, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, fmt.Errorf("user_id is required")
	}

	var entities []scanPathEntity
	if err := s.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("created_at ASC").
		Find(&entities).Error; err != nil {
		return nil, err
	}

	results := make([]*ScanPath, 0, len(entities))
	for _, e := range entities {
		results = append(results, toScanPath(e))
	}
	return results, nil
}

// GetScanPath returns a single scan path by its ID.
func (s *Store) GetScanPath(ctx context.Context, id string) (*ScanPath, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return nil, fmt.Errorf("id is required")
	}

	var entity scanPathEntity
	if err := s.db.WithContext(ctx).Take(&entity, "id = ?", id).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, fmt.Errorf("scan path not found: %s", id)
		}
		return nil, err
	}

	return toScanPath(entity), nil
}

// UpdateScanPathStatus updates the status, file count, and error message of a scan path.
func (s *Store) UpdateScanPathStatus(ctx context.Context, id, status string, fileCount int, errorMsg string) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return fmt.Errorf("id is required")
	}
	status = strings.TrimSpace(status)
	if status == "" {
		return fmt.Errorf("status is required")
	}

	now := time.Now().UTC()
	updates := map[string]any{
		"status":        status,
		"file_count":    fileCount,
		"error_message": errorMsg,
		"updated_at":    now,
	}

	if status == "completed" || status == "scanning" {
		updates["last_scan_at"] = now
	}

	result := s.db.WithContext(ctx).
		Model(&scanPathEntity{}).
		Where("id = ?", id).
		Updates(updates)

	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return fmt.Errorf("scan path not found: %s", id)
	}
	return nil
}

// DeleteScanPath removes a scan path by its ID.
func (s *Store) DeleteScanPath(ctx context.Context, id string) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return fmt.Errorf("id is required")
	}

	result := s.db.WithContext(ctx).
		Where("id = ?", id).
		Delete(&scanPathEntity{})

	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return fmt.Errorf("scan path not found: %s", id)
	}
	return nil
}
