import unittest

from server import normalize_images, normalize_thumbnails


class NormalizeImagesTest(unittest.TestCase):
    def test_instagram_cdn_thumbnail_sizes_are_deduped_to_largest_image(self) -> None:
        payload = {
            "thumbnail": "https://instagram.example.fbcdn.net/v/t51.82787-15/cover.jpg?stp=p1080&oh=old",
            "thumbnails": [
                {
                    "url": "https://instagram.example.fbcdn.net/v/t51.82787-15/cover.jpg?stp=p640&oh=a",
                    "width": 640,
                    "height": 1137,
                },
                {
                    "url": "https://instagram.example.fbcdn.net/v/t51.82787-15/cover.jpg?stp=p750&oh=b",
                    "width": 750,
                    "height": 1333,
                },
                {
                    "url": "https://instagram.example.fbcdn.net/v/t51.82787-15/cover.jpg?stp=p1080&oh=c",
                    "width": 1080,
                    "height": 1920,
                },
            ],
        }

        images = normalize_images(payload, normalize_thumbnails(payload["thumbnails"]))

        self.assertEqual(
            images,
            [
                {
                    "url": "https://instagram.example.fbcdn.net/v/t51.82787-15/cover.jpg?stp=p1080&oh=c",
                    "kind": "thumbnail",
                    "source": "top_level",
                    "width": 1080,
                    "height": 1920,
                }
            ],
        )

    def test_different_instagram_cdn_paths_are_kept_as_separate_images(self) -> None:
        payload = {
            "thumbnails": [
                {
                    "url": "https://instagram.example.fbcdn.net/v/t51.82787-15/cover.jpg?oh=a",
                    "width": 1080,
                    "height": 1920,
                },
                {
                    "url": "https://instagram.example.fbcdn.net/v/t51.82787-15/step.jpg?oh=b",
                    "width": 1080,
                    "height": 1080,
                },
            ],
        }

        images = normalize_images(payload, normalize_thumbnails(payload["thumbnails"]))

        self.assertEqual([image["url"] for image in images], [item["url"] for item in payload["thumbnails"]])


if __name__ == "__main__":
    unittest.main()
