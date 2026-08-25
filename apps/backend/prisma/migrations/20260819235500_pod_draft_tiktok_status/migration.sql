-- Trạng thái mới cho Draft Listing: đã tạo Draft Product trên TikTok nhưng CHƯA đăng bán.
-- Tách khỏi PUBLISHED để không ai nhầm "đã lên sàn" với "đã nằm trong mục Draft".

-- AlterEnum
ALTER TYPE "pod_draft_listing_status" ADD VALUE 'TIKTOK_DRAFT';

