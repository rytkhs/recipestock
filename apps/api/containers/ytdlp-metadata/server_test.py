import unittest

from server import (
    normalize_images,
    normalize_instagram_sidecar_images,
    normalize_thumbnails,
    normalize_ytdlp_metadata,
)


INSTAGRAM_SOURCE = {
    "platform": "instagram",
    "canonicalUrl": "https://www.instagram.com/p/DYsxvKyAZMg/",
    "shortcode": "DYsxvKyAZMg",
    "mediaKind": "post",
}


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

    def test_sidecar_images_are_prepended_before_ytdlp_thumbnails(self) -> None:
        payload = {
            "thumbnail": "https://instagram.example.fbcdn.net/v/t51.82787-15/video-cover.jpg?oh=cover",
        }
        sidecar_images = [
            {
                "url": "https://instagram.example.fbcdn.net/v/t51.82787-15/slide-1.jpg?oh=sidecar",
                "kind": "thumbnail",
                "source": "sidecar",
                "entryIndex": 0,
                "width": 1080,
                "height": 1080,
            }
        ]

        images = normalize_images(
            payload,
            normalize_thumbnails(payload.get("thumbnails")),
            sidecar_images=sidecar_images,
        )

        self.assertEqual(
            [image["url"] for image in images],
            [
                "https://instagram.example.fbcdn.net/v/t51.82787-15/slide-1.jpg?oh=sidecar",
                "https://instagram.example.fbcdn.net/v/t51.82787-15/video-cover.jpg?oh=cover",
            ],
        )

    def test_graphql_sidecar_images_are_extracted_in_carousel_order(self) -> None:
        payload = create_graphql_sidecar_payload(8, include_video=True)

        images = normalize_instagram_sidecar_images(payload)

        self.assertEqual(len(images), 9)
        self.assertEqual([image["source"] for image in images], ["sidecar"] * 9)
        self.assertEqual([image["entryIndex"] for image in images], list(range(9)))
        self.assertEqual(
            [image["url"] for image in images],
            [f"https://instagram.example.fbcdn.net/v/t51.82787-15/slide-{index}-large.jpg" for index in range(9)],
        )

    def test_graphql_sidecar_image_uses_largest_display_resource(self) -> None:
        payload = create_graphql_sidecar_payload(1)

        images = normalize_instagram_sidecar_images(payload)

        self.assertEqual(
            images[0],
            {
                "url": "https://instagram.example.fbcdn.net/v/t51.82787-15/slide-0-large.jpg",
                "kind": "thumbnail",
                "source": "sidecar",
                "entryIndex": 0,
                "width": 1080,
                "height": 1080,
            },
        )

    def test_invalid_graphql_sidecar_payload_is_ignored(self) -> None:
        self.assertEqual(normalize_instagram_sidecar_images({}), [])
        self.assertEqual(normalize_instagram_sidecar_images({"data": {"xdt_shortcode_media": None}}), [])

    def test_ytdlp_metadata_succeeds_when_graphql_sidecar_images_are_absent(self) -> None:
        result = normalize_ytdlp_metadata(
            INSTAGRAM_SOURCE,
            {
                "extractor": "Instagram",
                "webpage_url": "https://www.instagram.com/p/DYsxvKyAZMg/",
                "title": "Post by mizuki_31cafe",
                "description": "caption",
                "thumbnail": "https://instagram.example.fbcdn.net/v/t51.82787-15/cover.jpg?oh=a",
            },
            sidecar_images=[],
        )

        self.assertEqual(result["ok"], True)
        self.assertEqual(
            result["images"],
            [
                {
                    "url": "https://instagram.example.fbcdn.net/v/t51.82787-15/cover.jpg?oh=a",
                    "kind": "thumbnail",
                    "source": "top_level",
                }
            ],
        )


def create_graphql_sidecar_payload(image_count: int, *, include_video: bool = False) -> dict:
    edges = [
        {
            "node": {
                "__typename": "XDTGraphImage",
                "is_video": False,
                "shortcode": f"IMAGE{index}",
                "display_url": f"https://instagram.example.fbcdn.net/v/t51.82787-15/slide-{index}-display.jpg",
                "thumbnail_src": f"https://instagram.example.fbcdn.net/v/t51.82787-15/slide-{index}-thumb.jpg",
                "display_resources": [
                    {
                        "src": f"https://instagram.example.fbcdn.net/v/t51.82787-15/slide-{index}-small.jpg",
                        "config_width": 640,
                        "config_height": 640,
                    },
                    {
                        "src": f"https://instagram.example.fbcdn.net/v/t51.82787-15/slide-{index}-large.jpg",
                        "config_width": 1080,
                        "config_height": 1080,
                    },
                ],
            }
        }
        for index in range(image_count)
    ]

    if include_video:
        index = len(edges)
        edges.append(
            {
                "node": {
                    "__typename": "XDTGraphVideo",
                    "is_video": True,
                    "shortcode": "DYsxtTngTNq",
                    "display_resources": [
                        {
                            "src": f"https://instagram.example.fbcdn.net/v/t51.82787-15/slide-{index}-large.jpg",
                            "config_width": 1080,
                            "config_height": 1350,
                        }
                    ],
                }
            }
        )

    return {
        "data": {
            "xdt_shortcode_media": {
                "edge_sidecar_to_children": {
                    "edges": edges,
                }
            }
        }
    }


if __name__ == "__main__":
    unittest.main()
